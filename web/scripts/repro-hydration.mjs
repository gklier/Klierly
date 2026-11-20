// Provokes the intermittent hydration error described in docs/KNOWN_ISSUES.md.
// Needs a running PRODUCTION server (npm run build && npm start), the worker, and an existing account:
//   EMAIL=you@example.com PASSWORD='...' BASE=http://localhost:3000 node scripts/repro-hydration.mjs [rounds]
// It creates throwaway courses in that account. The import limit (60 per 10 minutes) allows ~12 rounds per server restart.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const base = process.env.BASE ?? "http://localhost:3000";
const { EMAIL, PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("Set EMAIL and PASSWORD."); process.exit(1); }
const rounds = Number(process.argv[2] ?? 10);
const dir = fileURLToPath(new URL("../../fixtures/qmb-sample/", import.meta.url));
const files = ["syllabus.md", "module1-simple-regression.pdf", "module2-multiple-regression.docx", "module4-forecasting.md", "lecture-module2.vtt"].map((f) => dir + f);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
let where = "";
page.on("console", (m) => { if (m.type() === "error") errors.push(`${where}: ${m.text().slice(0, 300)}`); });
page.on("pageerror", (e) => errors.push(`${where}: ${e.message.slice(0, 300)}`));

await page.goto(`${base}/login`);
await page.waitForLoadState("networkidle");
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
await page.waitForURL(`${base}/`);
for (let r = 1; r <= rounds; r++) {
  await page.goto(`${base}/courses/new`);
  await page.waitForLoadState("networkidle");
  await page.fill("#name", `Hydration repro ${r}`);
  await page.getByRole("button", { name: "Create course" }).click();
  await page.waitForURL(/\/materials/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("tabpanel").getByRole("checkbox").check();
  await page.locator("#file-input").setInputFiles(files);
  for (let i = 0; i < 8; i++) { where = `round ${r}, reload ${i}`; await page.reload({ waitUntil: "load" }); await page.waitForTimeout(100); }
}
await browser.close();
console.log(`${rounds} rounds, ${errors.length} console error(s)`);
for (const e of new Set(errors)) console.log(` - ${e}`);
process.exit(errors.length ? 2 : 0);
