import { enrollTestAccount } from "./passkey-helper";
import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Browser-extension E2E against the real web app.
 *
 * Playwright cannot click the browser toolbar, so `activeTab` is never granted
 * in automation. The harness therefore copies the extension to a temp folder
 * and adds, IN THAT COPY ONLY, a host permission for the local fixture server
 * (plus a key that pins the extension id). The shipped manifest is untouched
 * and is asserted to be minimal by extension/tests/unit.
 */
const EXT_SRC = path.resolve(__dirname, "../../extension");
const FIXTURES = path.join(EXT_SRC, "tests/fixtures");
const LMS = "http://localhost:3200";
const APP = "http://localhost:3100";
const ROUTES: Record<string, string> = {
  "/courses/1/pages/module-3": "mock-lms-page.html", "/courses/1/quizzes/7/take": "mock-active-quiz.html",
  "/courses/1/pages/syllabus": "mock-syllabus.html", "/courses/1/grades": "mock-lms-page.html",
};
const FORBIDDEN = ["HIDDEN-ANSWER-KEY", "INVISIBLE-TRACKING-TEXT", "ARIA-HIDDEN-DECORATION", "TYPED-SEARCH-VALUE", "SUPER-SECRET-PASSWORD", "DRAFT-REPLY-TEXT", "GRADE-VALUE-87", "IFRAME-CONTENT", "SCRIPT-TEXT", "SIDEBAR-TODO", "FOOTER-LEGAL-TEXT", "GlobalNavAccountLink", "CourseNavGrades"];

let lms: http.Server, ctx: BrowserContext, app: Page, extId = "", token = "", courseId = "", tmp = "";
const importRequests: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  lms = http.createServer((req, res) => {
    const file = ROUTES[(req.url ?? "").split("?")[0]];
    if (!file) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fs.readFileSync(path.join(FIXTURES, file)));
  });
  await new Promise<void>((r) => lms.listen(3200, "127.0.0.1", r));

  // A real account, course, module and pairing token in the web app.
  app = await (await browser.newContext()).newPage();
  await enrollTestAccount(app, "Ext Tester", "ext@e2e.test");
  await app.goto("/courses/new");
  await app.getByLabel("Course name").fill("Extension test course");
  await app.getByRole("button", { name: "Create course" }).click();
  await app.waitForURL(/\/materials$/);
  courseId = /courses\/([0-9a-f-]+)/.exec(app.url())![1];
  await app.getByLabel("New module name").fill("Module 3: Indicator Variables");
  await app.getByLabel("New module name").press("Enter");
  await expect(app.getByText("Added “Module 3: Indicator Variables”.")).toBeVisible();
  await app.goto("/settings");
  await app.getByLabel("Name for this browser").fill("E2E Chromium");
  await app.getByRole("button", { name: "Create pairing token" }).click();
  token = await app.getByTestId("ext-token").innerText();
  expect(token).toMatch(/^clx_/);

  // Test copy of the extension with a host permission for the fixture origin only.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "klierly-ext-"));
  const copy = path.join(tmp, "ext");
  fs.cpSync(EXT_SRC, copy, { recursive: true, filter: (src) => !/node_modules|dist|tests/.test(path.relative(EXT_SRC, src)) });
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const der = publicKey.export({ type: "spki", format: "der" });
  extId = [...createHash("sha256").update(der).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
  const manifest = JSON.parse(fs.readFileSync(path.join(copy, "manifest.json"), "utf8"));
  fs.writeFileSync(path.join(copy, "manifest.json"), JSON.stringify({ ...manifest, key: der.toString("base64"), host_permissions: [`${LMS}/*`] }));
  ctx = await chromium.launchPersistentContext(path.join(tmp, "profile"), { channel: "chromium", headless: true, args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`] });
  ctx.on("request", (r) => { if (r.url().includes("/api/ext/import")) importRequests.push(r.method()); });
});

test.afterAll(async () => {
  await ctx?.close();
  await new Promise((r) => lms.close(r));
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

async function openPopupFor(pathname: string): Promise<Page> {
  const target = await ctx.newPage();
  await target.goto(LMS + pathname);
  const helper = await ctx.newPage();
  await helper.goto(`chrome-extension://${extId}/options.html`);
  const tabId = await helper.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, LMS + pathname);
  await helper.close();
  expect(tabId).toBeTruthy();
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
  return popup;
}
declare const chrome: { tabs: { query(q: { url: string }): Promise<{ id?: number }[]> } };

test("popup explains how to connect when no token is saved", async () => {
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await expect(popup.getByText("Not connected yet.")).toBeVisible();
  await expect(popup.getByText("Not affiliated with or endorsed by any LMS or university.")).toBeVisible();
  await popup.close();
});

test("options: bad token is refused, a real pairing token connects", async () => {
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html`);
  await options.getByLabel("Klierly server address").fill("http://klierly.example.edu");
  await options.getByLabel("Pairing token").fill(token);
  await options.getByRole("button", { name: "Test connection" }).click();
  await expect(options.getByRole("status")).toContainText("Use https://");
  await options.getByLabel("Klierly server address").fill(APP);
  await options.getByLabel("Pairing token").fill("clx_this-token-does-not-exist-000000");
  await options.getByRole("button", { name: "Test connection" }).click();
  await expect(options.getByRole("status")).toContainText("pairing token was not accepted");
  await options.getByLabel("Pairing token").fill(token);
  await options.getByRole("button", { name: "Save" }).click();
  await expect(options.getByRole("status")).toContainText("Connected to localhost:3100 as ext@e2e.test — 1 course.");
  await options.close();
});

test("capture a course page: preview first, nothing sent before Import, source appears in the course", async () => {
  const popup = await openPopupFor("/courses/1/pages/module-3");
  const preview = popup.getByLabel(/Text that will be imported/);
  await expect(preview).toHaveValue(/An indicator variable takes the value 1/);
  const text = await preview.inputValue();
  expect(text).toContain("The category that receives no indicator is the baseline category.");
  for (const secret of FORBIDDEN) expect(text, secret).not.toContain(secret);
  await expect(popup.getByText(/Left out:/)).toContainText("form fields");
  await expect(popup.getByLabel("Title", { exact: true })).toHaveValue("Module 3: Indicator Variables — Mock LMS");
  await expect(popup.getByText("Nothing has been sent so far.")).toBeVisible();
  await expect(popup.locator("#server-host")).toHaveText("localhost:3100");

  await expect(popup.getByLabel("Course", { exact: true })).toHaveValue(courseId);
  await expect(popup.getByRole("button", { name: "Import" })).toBeDisabled(); // declaration not ticked
  expect(importRequests).toEqual([]);
  await popup.getByLabel("Title", { exact: true }).fill("Module 3 page (captured)");
  await popup.getByLabel("Module", { exact: true }).selectOption({ label: "Module 3: Indicator Variables" });
  await popup.getByLabel(/I have permission to use this material/).check();
  await popup.getByRole("button", { name: "Import" }).click();
  await expect(popup.getByText("Imported.")).toBeVisible();
  expect(importRequests.filter((m) => m === "POST")).toHaveLength(1);
  const viewUrl = await popup.getByRole("link", { name: "Open it in Klierly" }).getAttribute("href");
  expect(viewUrl).toMatch(new RegExp(`^${APP}/courses/${courseId}/materials/[0-9a-f-]+$`));
  await popup.close();

  // The capture went through the normal ingestion pipeline and is visible in the web app.
  await app.goto(viewUrl!);
  await expect(app.getByRole("heading", { name: "Module 3 page (captured)" })).toBeVisible();
  await expect(app.getByText("Web capture")).toBeVisible();
  await expect(app.locator("header .badge", { hasText: "Module 3: Indicator Variables" })).toBeVisible(); // module mapping
  await expect(app.getByRole("link", { name: `${LMS}/courses/1/pages/module-3` })).toBeVisible(); // source link
  await expect(app.getByText("An indicator variable takes the value 1").first()).toBeVisible();
  for (const secret of FORBIDDEN) await expect(app.getByText(secret)).toHaveCount(0);
  await app.goto(`/courses/${courseId}/materials`);
  await expect(app.getByRole("link", { name: "Module 3 page (captured)", exact: true })).toBeVisible();
  await expect(app.getByText("Extraction 100%")).toBeVisible();

  // Importing the same page again is recognised as a duplicate.
  const again = await openPopupFor("/courses/1/pages/module-3");
  await again.getByLabel(/I have permission to use this material/).check();
  await again.getByRole("button", { name: "Import" }).click();
  await expect(again.getByText("Already imported.")).toBeVisible();
  await again.close();
});

test("an active quiz is blocked: no preview, no import", async () => {
  const before = importRequests.length;
  const popup = await openPopupFor("/courses/1/quizzes/7/take");
  await expect(popup.getByRole("heading", { name: "This page looks like an assessment in progress" })).toBeVisible();
  await expect(popup.getByText("Klierly does not capture or help with graded assessments.")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Import" })).toBeHidden();
  await expect(popup.getByLabel(/Text that will be imported/)).toBeHidden();
  expect(await popup.content()).not.toMatch(/QUIZ-QUESTION|QUIZ-CHOICE/); // question text never reaches the popup
  expect(importRequests.length).toBe(before);
  await popup.close();
});

test("a grades page is blocked as personal records", async () => {
  const popup = await openPopupFor("/courses/1/grades");
  await expect(popup.getByRole("heading", { name: "This page is not study material" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Import" })).toBeHidden();
  await popup.close();
});

test("a syllabus that mentions exams and proctoring is not blocked", async () => {
  const popup = await openPopupFor("/courses/1/pages/syllabus");
  await expect(popup.getByLabel(/Text that will be imported/)).toHaveValue(/Exam 1: December 4, 2026/);
  await expect(popup.locator("#cautions")).toContainText("Respondus"); // a caution, not a block
  await expect(popup.getByRole("button", { name: "Import" })).toBeVisible();
  await popup.close();
});

test("the server enforces the same rules without trusting the extension", async ({ request }) => {
  const auth = { Authorization: `Bearer ${token}` };
  const body = { courseId, moduleId: null, title: "Notes", url: `${LMS}/courses/1/pages/x`, text: "Some ordinary study notes about regression slopes.", selectionOnly: false, permissionConfirmed: true };
  const post = (data: object, headers: Record<string, string> = auth) => request.post("/api/ext/import", { data, headers });
  expect((await post(body, { Authorization: "Bearer clx_wrong-wrong-wrong-wrong-wrong" })).status()).toBe(401);
  expect((await post(body, {})).status()).toBe(401);
  expect((await (await post({ ...body, permissionConfirmed: false })).json()).error.code).toBe("permission_required");
  expect((await (await post({ ...body, text: "  " })).json()).error.code).toBe("empty_capture");
  expect((await (await post({ ...body, url: `${LMS}/courses/1/quizzes/7/take` })).json()).error.code).toBe("assessment_blocked");
  expect((await (await post({ ...body, text: "Question 3 of 10\nTime Remaining 04:10\nSubmit Quiz" })).json()).error.code).toBe("assessment_blocked");
  expect((await (await post({ ...body, courseId: "00000000-0000-0000-0000-000000000000" })).json()).error.code).toBe("course_not_found");
  expect((await post({ ...body, text: "x".repeat(400_001) })).status()).toBe(413);
  // The pairing token is only valid for /api/ext/*.
  expect((await request.get(`/api/courses/${courseId}/status`, { headers: auth })).status()).toBe(401);
  expect((await request.get(`/courses/${courseId}`, { headers: auth, maxRedirects: 0 })).status()).toBe(307);
  // CORS: extension origins only.
  const pre = await request.fetch("/api/ext/import", { method: "OPTIONS", headers: { Origin: `chrome-extension://${extId}`, "Access-Control-Request-Method": "POST" } });
  expect(pre.headers()["access-control-allow-origin"]).toBe(`chrome-extension://${extId}`);
  const web = await request.fetch("/api/ext/import", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
  expect(web.headers()["access-control-allow-origin"]).toBeUndefined();
  // Revoking the token cuts the extension off.
  await app.goto("/settings");
  await app.getByRole("button", { name: "Revoke" }).click();
  await expect(app.getByText("No pairing tokens yet.")).toBeVisible();
  expect((await request.get("/api/ext/courses", { headers: auth })).status()).toBe(401);
});
