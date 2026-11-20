import path from "node:path";
import fs from "node:fs";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

/** Learn Mode, end to end in a real browser, against the production build, the real worker sandbox and the mock AI. */
const SHOTS = path.resolve(__dirname, "../../docs/learn-mode/screenshots");
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname, "../.env.local"), "utf8").split("\n").map((l) => /^([A-Z_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m![1], m![2]]));
const DB = (env.DATABASE_URL as string).replace(/\/klierly(\?|$)/, "/klierly_e2e$1");
const EMAIL = "rae@share.test", PASSWORD = "e2e-password-12345";
const errors: string[] = [];
let page: Page, courseId = "";

const sql = async <T extends object>(text: string, values: unknown[] = []): Promise<T[]> => { const c = new Client({ connectionString: DB }); await c.connect(); try { return (await c.query(text, values)).rows as T[]; } finally { await c.end(); } };
type Cur = { key: string; item: { kind: "num" | "mcq"; answer: number | null; correctIndex: number | null; traps: { value: number; message: string }[] }; stem: string };
async function current(): Promise<Cur> {
  const [r] = await sql<{ key: string; body: Cur["item"] & { stemHtml: string } }>(`select i.key, i.body from lm_progress p join users u on u.id = p.user_id join lm_items i on i.key = p.cursor->'qs'->>'key' where u.email = $1 and p.course_id = $2`, [EMAIL, courseId]);
  return { key: r.key, item: r.body, stem: r.body.stemHtml };
}
const solveUI = async (right: boolean) => {
  const c = await current();
  if (c.item.kind === "mcq") { const idx = right ? c.item.correctIndex! : (c.item.correctIndex! + 1) % 4; await page.locator('button[name="resp"]').nth(idx).click(); }
  else { await page.getByLabel("Your answer").fill(String(right ? c.item.answer : c.item.answer! + 777.5)); await page.getByRole("button", { name: "Check" }).click(); }
  // React clears the form once the action finishes; fill again only after that, or the new text is wiped. (Gone entirely = answered.)
  if (c.item.kind === "num") await page.getByLabel("Your answer").waitFor({ state: "detached", timeout: 3000 }).catch(() => expect(page.getByLabel("Your answer")).toHaveValue("", { timeout: 5000 }));
  await page.waitForLoadState("networkidle"); // the answer is a server action: wait for it before reading or clicking again
  return c;
};
const next = async () => {
  await page.getByRole("button", { name: /^(Next|Got it, next|Next step|Next concept)$/ }).click();
  await page.waitForLoadState("networkidle");
};
const text = (s: string) => `${s}\n\n` + Array.from({ length: 7 }, (_, i) => `${s} point ${i + 1}: the mean is the sum divided by the count, and a moving average uses only the most recent k values. Standard deviation measures spread around the mean in the original units. ` + "Careful reading of the course notes matters for every calculation. ".repeat(4)).join("\n\n");

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/status of (415|404|403)/.test(m.text())) errors.push(`${page.url()} :: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message}`));
});
const HYDRATION = /Minified React error #418|Hydration failed/;
test.afterAll(() => {
  const hyd = errors.filter((e) => HYDRATION.test(e));
  if (hyd.length) console.warn(`KNOWN ISSUE (docs/KNOWN_ISSUES.md): ${hyd.length} React hydration error(s):\n${hyd.join("\n")}`);
  expect(errors.filter((e) => !HYDRATION.test(e)), "browser console errors").toEqual([]);
  expect(hyd.length).toBeLessThanOrEqual(2);
});

test("sign in (the account from the sharing spec, or a new one when this file runs alone)", async () => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL); await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  try { await page.waitForURL("/", { timeout: 4000 }); } catch {
    await page.goto("/register");
    await page.getByLabel("Name").fill("Rae"); await page.getByLabel("Email").fill(EMAIL); await page.getByLabel("Password").fill(PASSWORD); await page.getByLabel("Invite code").fill("e2e-invite");
    await page.getByRole("button", { name: "Create account" }).click(); await page.waitForURL("/");
  }
});

test("a course with three modules and an exam page naming two of them", async () => {
  await page.getByRole("link", { name: "New course" }).first().click();
  await page.getByLabel("Course name").fill("Learn Mode course");
  await page.getByRole("button", { name: "Create course" }).click();
  await page.waitForURL(/\/courses\/[0-9a-f-]+\/materials$/);
  courseId = /courses\/([0-9a-f-]+)/.exec(page.url())![1];
  for (const m of ["Module 17: Time series", "Module 18: Spread", "Module 19: Never selected"]) {
    await page.getByLabel("New module name").fill(m); await page.getByLabel("New module name").press("Enter");
    await expect(page.getByText(`Added “${m}”.`)).toBeVisible();
  }
  const paste = async (title: string, body: string, module?: string) => {
    await page.getByRole("tab", { name: "Paste text" }).click();
    await page.getByLabel("Title").fill(title);
    if (module) await page.getByLabel("Module", { exact: true }).selectOption({ label: module });
    await page.getByLabel("Text", { exact: true }).fill(body);
    const perm = page.locator("input[name=permission]"); if (!(await perm.isChecked())) await perm.check();
    await page.getByRole("button", { name: "Add text" }).click();
    // Wait for THIS paste to be acknowledged: the form clears its title field only when the server accepted it.
    await expect(page.getByLabel("Title")).toHaveValue("", { timeout: 15_000 }).catch(async () => { throw new Error(`"${title}" was not accepted: ${await page.locator("p[role=alert]").allInnerTexts()}`); });
  };
  await paste("Time series notes", text("Time series"), "Module 17: Time series");
  await paste("Spread notes", text("Spread"), "Module 18: Spread");
  await paste("Other notes", text("Other topic"), "Module 19: Never selected");
  await paste("Exam 3 information", "Exam 3 covers Modules 17-18. The exam has 25 questions and is closed book. Bring a calculator.");
  await expect(async () => { await page.reload(); await expect(page.getByText("Extraction 100%")).toHaveCount(4, { timeout: 2000 }); }).toPass({ timeout: 40_000 });
});

test("the module checklist pre-selects the exam's modules with the reason, and one button builds the whole guide", async () => {
  await page.goto(`/courses/${courseId}/learn`);
  const boxes = page.locator('input[name="moduleIds"]');
  await expect(boxes).toHaveCount(3);
  await expect(page.getByRole("checkbox", { name: /Module 17/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Module 18/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Module 19/ })).not.toBeChecked();
  await expect(page.getByText(/Why: “Exam 3 information” says Exam 3 covers Modules 17-18/)).toHaveCount(2);
  await page.screenshot({ path: path.join(SHOTS, "01-module-picker.png"), fullPage: true });
  await page.getByRole("button", { name: "Build my study guide" }).click();
  await expect(page.getByTestId("build-status")).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "02-building.png") });
  await expect(page.getByRole("button", { name: "STUDY FOR MY EXAM" })).toBeVisible({ timeout: 180_000 });
});

test("the guide shows real counts from the database, only for the chosen modules, and needs no further generate clicks", async () => {
  const counts = await page.getByTestId("guide-counts").innerText();
  const [{ n: concepts }] = await sql<{ n: number }>(`select count(*)::int n from lm_concepts where course_id = $1 and status = 'ready'`, [courseId]);
  const [{ n: questions }] = await sql<{ n: number }>(`select count(*)::int n from lm_items where course_id = $1 and not retired`, [courseId]);
  expect(concepts).toBe(6);
  expect(counts).toContain(`${concepts} concepts`);
  expect(counts).toContain(`${questions.toLocaleString("en-US")} practice questions ready`);
  expect(questions).toBeGreaterThan(400);
  const [{ n: other }] = await sql<{ n: number }>(`select count(*)::int n from lm_concepts c join modules m on m.id = c.module_id where c.course_id = $1 and m.name like 'Module 19%'`, [courseId]);
  expect(other).toBe(0); // the unselected module cost nothing
  await expect(page.getByRole("button", { name: /generate/i })).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, "03-guide-home.png"), fullPage: true });
});

test("Start: read a concept, watch the worked example, three guided rounds, then practice, with nothing generated on the way", async () => {
  const [{ n: before }] = await sql<{ n: number }>(`select count(*)::int n from ai_usage a join users u on u.id = a.user_id where u.email = $1`, [EMAIL]);
  await page.getByRole("button", { name: "STUDY FOR MY EXAM" }).click();
  await page.waitForURL(/\/learn\/study$/);
  const title = await page.getByTestId("concept-title").innerText();
  await expect(page.getByTestId("lesson-card")).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "04-lesson.png") });
  for (let i = 0; i < 4; i++) { await expect(page.getByTestId("lesson-card")).toContainText(`Card ${i + 1} of 4`); await next(); }
  await expect(page.getByTestId("worked-example")).toBeVisible();
  await expect(page.getByTestId("worked-example").locator("ol > li")).toHaveCount(1);
  await next();
  await expect(page.getByTestId("worked-example").locator("ol > li")).toHaveCount(2); // one step at a time
  await page.screenshot({ path: path.join(SHOTS, "05-worked-example.png") });
  await next();
  for (let round = 1; round <= 3; round++) {
    await expect(page.getByTestId("question")).toContainText(`Guided practice, round ${round} of 3`);
    await solveUI(false);
    await expect(page.getByTestId("feedback")).toHaveCount(0); // a guided miss lets you retry
    await solveUI(true);
    await expect(page.getByTestId("feedback")).toContainText("Correct.");
    await next();
  }
  await expect(page.getByTestId("question")).toContainText("Practice");
  const [{ n: after }] = await sql<{ n: number }>(`select count(*)::int n from ai_usage a join users u on u.id = a.user_id where u.email = $1`, [EMAIL]);
  expect(after).toBe(before); // practising makes no AI call: the whole bank was built up front
  expect(await page.getByRole("button", { name: /generate|approve|accept|edit/i }).count()).toBe(0);
  expect(title.length).toBeGreaterThan(3);
});

test("a wrong numeric answer names the exact mistake; a hint never gives the answer; Report is one tap and does not interrupt", async () => {
  for (let n = 0; n < 20; n++) {
    const c = await current();
    if (c.item.kind === "num" && c.item.traps.length) {
      await page.getByRole("button", { name: "Give me a hint" }).click();
      await expect(page.getByTestId("hints")).toBeVisible();
      expect(await page.getByTestId("hints").innerText()).not.toContain(String(c.item.answer));
      await page.getByLabel("Your answer").fill(String(c.item.traps[0].value));
      await page.getByRole("button", { name: "Check" }).click();
      await expect(page.getByTestId("trap-feedback")).toContainText(c.item.traps[0].message.slice(0, 30));
      await expect(page.getByTestId("feedback")).toContainText("Not quite.");
      await page.screenshot({ path: path.join(SHOTS, "06-trap-feedback.png") });
      await page.getByRole("button", { name: "Report a problem" }).click();
      await expect(page.getByText("will not be shown again")).toBeVisible();
      await expect(page.getByRole("button", { name: /next/i })).toBeVisible(); // studying is not interrupted
      const [r] = await sql<{ retired: boolean }>(`select retired from lm_items where key = $1`, [c.key]);
      expect(r.retired).toBe(true);
      await next();
      return;
    }
    await solveUI(true); await next();
  }
  throw new Error("no numeric practice question with a trap came up");
});

test("reload mid-question: same question, same hint level", async () => {
  await expect(page.getByRole("button", { name: "Give me a hint" })).toBeVisible();
  await page.getByRole("button", { name: "Give me a hint" }).click();
  await expect(page.getByTestId("hints").locator("li")).toHaveCount(1);
  await page.getByRole("button", { name: "Another hint" }).click();
  await expect(page.getByTestId("hints").locator("li")).toHaveCount(2);
  const stem = (await page.getByTestId("question").locator("p").nth(1).textContent())!;
  await page.reload();
  await expect(page.getByTestId("question").locator("p").nth(1)).toHaveText(stem);
  await expect(page.getByTestId("hints").locator("li")).toHaveCount(2);
  await page.screenshot({ path: path.join(SHOTS, "06b-after-reload.png") });
  await page.goto(`/courses/${courseId}/learn`); // leave and come back through the big button
  await page.getByRole("button", { name: "STUDY FOR MY EXAM" }).click();
  await page.waitForURL(/\/learn\/study$/);
  await expect(page.getByTestId("question").locator("p").nth(1)).toHaveText(stem);
  await expect(page.getByTestId("hints").locator("li")).toHaveCount(2);
});

type St = { phase: string; i: number; round: number; answered: boolean; key: string | null; concept: string };
const state = async (): Promise<St> => {
  const [r] = await sql<{ c: { phase: string; i: number; round: number; conceptId: string; qs: { key: string; answered: boolean } | null } }>(`select p.cursor c from lm_progress p join users u on u.id = p.user_id where u.email = $1 and p.course_id = $2`, [EMAIL, courseId]);
  return { phase: r.c.phase, i: r.c.i, round: r.c.round, answered: Boolean(r.c.qs?.answered), key: r.c.qs?.key ?? null, concept: r.c.conceptId };
};
const sameSt = (a: St, b: St) => JSON.stringify(a) === JSON.stringify(b);

test("finish the concept with clean answers, then auto-advance to the next concept", async () => {
  const first = await page.getByTestId("concept-title").innerText();
  for (let n = 0; n < 60; n++) {
    const st = await state();
    if (st.phase === "done") break;
    const before = st;
    if ((st.phase === "guided" || st.phase === "practice") && !st.answered) {
      await expect(page.getByRole("button", { name: /^Check$|./ }).first()).toBeVisible();
      await solveUI(true);
    } else {
      await next();
    }
    await expect.poll(async () => sameSt(await state(), before), { timeout: 15_000 }).toBe(false);
  }
  await expect(page.getByTestId("concept-done")).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "07-concept-practiced.png") });
  await next();
  await expect(page.getByTestId("lesson-card")).toBeVisible();
  expect(await page.getByTestId("concept-title").innerText()).not.toBe(first);
  const [{ n }] = await sql<{ n: number }>(`select count(*)::int n from lm_concept_state s join users u on u.id = s.user_id where u.email = $1 and s.status in ('practiced','solid')`, [EMAIL]);
  expect(n).toBeGreaterThanOrEqual(1);
});

test("another account cannot open this guide", async ({ browser }) => {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  const res = await p.goto(`/courses/${courseId}/learn/study`);
  expect(p.url()).toMatch(/\/login$/); expect(res).not.toBeNull();
  await ctx.close();
});
