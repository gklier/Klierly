import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIX = path.resolve(__dirname, "../../fixtures");
const consoleErrors: string[] = [];
let page: Page;
let courseUrl = "";

const watch = (p: Page) => {
  // The browser logs every non-2xx response as a console error. 415 (rejected upload), 404 (other user's
  // course) and 403 are provoked on purpose by these tests; everything else must stay clean.
  p.on("console", (m) => { if (m.type() === "error" && !/status of (415|404|403)/.test(m.text())) consoleErrors.push(`${p.url()} :: ${m.text()}`); });
  p.on("pageerror", (e) => consoleErrors.push(`${p.url()} :: ${e.message}`));
};

async function register(p: Page, name: string, email: string) {
  await p.goto("/register");
  await p.getByLabel("Name").fill(name);
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill("e2e-password-12345");
  await p.getByLabel("Invite code").fill("e2e-invite");
  await p.getByRole("button", { name: "Create account" }).click();
  await p.waitForURL("/");
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => { page = await (await browser.newContext()).newPage(); watch(page); });
test.afterAll(async () => { expect(consoleErrors, "browser console errors").toEqual([]); });

test("1. health check passes and the app requires sign-in", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok", database: true, worker: true });
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.get("/api/courses/00000000-0000-0000-0000-000000000000/status")).status()).toBe(401);
  await page.goto("/register");
  await page.getByLabel("Name").fill("X"); await page.getByLabel("Email").fill("x@example.com"); await page.getByLabel("Password").fill("e2e-password-12345"); await page.getByLabel("Invite code").fill("wrong");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("invite code is not valid");
});

test("2. create an account and a course", async () => {
  await register(page, "Founder", "founder@e2e.test");
  await expect(page.getByRole("heading", { name: "Your courses" })).toBeVisible();
  await page.getByRole("link", { name: "New course" }).first().click();
  await page.getByLabel("Course name").fill("QMB 3250 – Statistics for Business Decisions");
  await page.getByLabel(/^Term/).fill("Fall 2026");
  await page.getByLabel(/^Your goal/).fill("Read regression output without notes");
  await page.getByRole("button", { name: "Create course" }).click();
  await page.waitForURL(/\/courses\/[0-9a-f-]+\/materials$/);
  courseUrl = page.url().replace(/\/materials$/, "");
  await expect(page.getByText("No sources yet.")).toBeVisible();
});

test("3. upload valid files; bad and unsupported uploads fail clearly", async () => {
  await expect(page.getByRole("button", { name: "Choose files" })).toBeDisabled(); // permission declaration first
  await page.getByRole("tabpanel").getByRole("checkbox").check();
  await page.locator("#file-input").setInputFiles([
    path.join(FIX, "qmb-sample/syllabus.md"), path.join(FIX, "qmb-sample/module1-simple-regression.pdf"), path.join(FIX, "qmb-sample/module2-multiple-regression.docx"),
    path.join(FIX, "qmb-sample/module4-forecasting.md"), path.join(FIX, "bad/not-a-pdf.pdf"), path.join(FIX, "bad/malware.exe"),
  ]);
  await expect(page.getByText('Files of type ".exe" are not supported')).toBeVisible();
  const sources = page.getByRole("region", { name: /^Sources/ });
  await expect(sources.getByText("Extraction 100%")).toHaveCount(4, { timeout: 30_000 });
  await expect(sources.getByText("Failed")).toHaveCount(1);
  await expect(sources.getByText(/named \.pdf but its content is not a PDF/)).toBeVisible();
  await expect(sources.getByRole("link", { name: "Module 1: Simple Linear Regression" })).toBeVisible();
  // Same file again is recognised as a duplicate.
  await page.locator("#file-input").setInputFiles(path.join(FIX, "qmb-sample/syllabus.md"));
  await expect(page.getByText("Already in this course")).toBeVisible();
});

test("4. review suggestions drawn from the materials and accept them", async () => {
  const sugg = page.getByRole("region", { name: /Suggestions from your materials/ });
  await expect(sugg.getByText("Module 3: Indicator Variables and Interactions")).toBeVisible();
  await expect(sugg.getByText(/Exam 1 — covers Modules 1–3/)).toBeVisible();
  await expect(sugg.getByText("Interpret a partial slope while holding the other predictors fixed.")).toBeVisible();
  await sugg.getByRole("button", { name: "Dismiss Topic: Stepwise selection caveats" }).click();
  await expect(sugg.getByText("Stepwise selection caveats")).toHaveCount(0);
  await sugg.getByRole("button", { name: "Accept all" }).click();
  await expect(sugg).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Module 2: Multiple Regression and Model Building", level: 3 })).toBeVisible();
  await expect(page.getByText(/All \d+ topics are supported by imported text/)).toBeVisible();
  await expect(page.getByText("No sources assigned to: Module 3: Indicator Variables and Interactions.")).toBeVisible(); // missing material is reported
});

test("5. paste visible page text with a module; it persists", async () => {
  await page.getByRole("tab", { name: "Paste text" }).click();
  await page.getByLabel("Title").fill("Module 3 page: indicator variables");
  await page.getByLabel("Module", { exact: true }).selectOption({ label: "Module 3: Indicator Variables and Interactions" });
  await page.getByLabel("Text", { exact: true }).fill("Indicator variables\n\nAn indicator variable takes the value 1 when an observation is in a category and 0 otherwise. A categorical variable with c categories needs c - 1 indicator variables. The category that receives no indicator is the baseline category.");
  await page.getByLabel(/^Page address/).fill("https://lms.example.edu/courses/1/pages/indicators");
  await page.getByRole("button", { name: "Add text" }).click();
  await expect(page.getByText("You must confirm", { exact: false }).or(page.locator("input[name=permission]:invalid"))).toHaveCount(1); // declaration is required
  await page.locator("input[name=permission]").check();
  await page.getByRole("button", { name: "Add text" }).click();
  await expect(page.getByText("was added and is being processed")).toBeVisible();
  await page.reload();
  const row = page.getByRole("listitem").filter({ hasText: "Module 3 page: indicator variables" }).first();
  await expect(row.getByText("Pasted")).toBeVisible();
  await expect(row.getByText("Extraction 100%")).toBeVisible();
  await expect(page.getByText("Every module has at least one source.")).toBeVisible();
  // An active-assessment paste is refused.
  await page.getByRole("tab", { name: "Paste text" }).click();
  await page.getByLabel("Title").fill("Quiz 3");
  await page.getByLabel("Text", { exact: true }).fill("Question 2 of 10. Time Remaining 09:12. Which is the slope? Submit Quiz");
  await page.locator("input[name=permission]").check();
  await page.getByRole("button", { name: "Add text" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("looks like an active assessment");
});

test("6. search opens the exact excerpt with its page number", async () => {
  await page.goto(`${courseUrl}/materials`);
  await page.getByLabel("Search your materials").fill("p-value null hypothesis");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: /Module 1: Simple Linear Regression · p\. 2/ }).first().click();
  await expect(page.getByRole("heading", { name: "Module 1: Simple Linear Regression" })).toBeVisible();
  const cited = page.locator("li[aria-current=true]");
  await expect(cited).toContainText("Cited excerpt");
  await expect(cited).toContainText("p. 2");
  await expect(cited).toContainText("A p-value is not the probability that the null hypothesis is true");
  // A reference to an excerpt that does not exist is reported, not invented.
  await page.goto(page.url().replace(/chunk=[0-9a-f-]+/, "chunk=00000000-0000-0000-0000-000000000000").split("#")[0]);
  await expect(page.getByText("Nothing is highlighted rather than guessing")).toBeVisible();
});

test("7. zero configuration: AI is included and no key is asked for; usage is visible", async () => {
  await page.goto(`${courseUrl}/practice`);
  await expect(page.getByTestId("ai-usage")).toContainText("Klierly AI is included — no key needed.");
  await expect(page.getByTestId("ai-usage")).toContainText("0 of 150 free requests used today");
  await expect(page.getByRole("button", { name: "Start drill" })).toBeDisabled(); // no questions yet
  await page.goto("/settings");
  await expect(page.getByTestId("managed-ai")).toContainText("Klierly AI is included");
  await expect(page.getByTestId("managed-ai")).toContainText("0 of 150");
  expect(await page.content()).not.toContain("test-key"); // server-side credential never reaches the browser
});

test("8. generate source-grounded questions and a study note without entering a key", async () => {
  await page.goto(`${courseUrl}/practice`);
  const gen = page.getByRole("region", { name: "Generate new questions" });
  for (const box of await gen.getByRole("checkbox").all()) if (await box.isEnabled()) await box.check();
  const checked = await gen.getByRole("checkbox", { checked: true }).count();
  expect(checked).toBeGreaterThanOrEqual(5);
  await gen.getByLabel("Per topic").selectOption("3");
  await gen.getByRole("button", { name: "Generate questions" }).click();
  const result = gen.locator(".notice-good");
  await expect(result).toBeVisible({ timeout: 90_000 });
  const added = Number(/Added (\d+) new questions/.exec(await result.innerText())?.[1]);
  expect(added).toBeGreaterThanOrEqual(10);
  await expect(result).toContainText("discarded by the checks"); // invalid drafts from the provider were rejected
  await expect(page.getByText(new RegExp(`${added} questions in this course`))).toBeVisible();

  await page.getByRole("region", { name: "Learn" }).getByRole("link").first().click();
  await expect(page.getByText("There is no study note for this topic yet.")).toBeVisible();
  await page.getByRole("button", { name: "Generate a study note with AI" }).click();
  await expect(page.getByText("AI-generated from your materials")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("list").getByRole("link", { name: /Module \d/ }).first()).toBeVisible();
  await expect(page.getByText("uncited claim")).toHaveCount(0);

  // Usage feedback for the student, and cost monitoring for the operator.
  await page.goto(`${courseUrl}/practice`);
  const usedText = await page.getByTestId("ai-usage").innerText();
  const used = Number(/(\d+) of 150 free requests/.exec(usedText)?.[1]);
  expect(used).toBeGreaterThanOrEqual(6);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Operator: managed AI" })).toBeVisible();
  await expect(page.getByTestId("month-total")).toContainText(`${used} requests · $0.`);
  await expect(page.getByRole("cell", { name: "founder@e2e.test" })).toBeVisible();
  expect(await page.content()).not.toContain("test-key");
});

test("8b. optional own provider: a bad key fails transparently, a good one connects and takes over, removing it returns to the included AI", async () => {
  await page.goto("/settings");
  await page.getByLabel("Base URL").fill("http://127.0.0.1:4012/v1");
  await page.getByLabel("Model ID").fill("mock-1");
  await page.getByLabel("API key").fill("definitely-wrong-key");
  await page.getByText("I understand that excerpts").click();
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("Saved. Use “Test connection”")).toBeVisible();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("The AI provider rejected the API key.")).toBeVisible();
  await expect(page.getByText("Last test failed")).toBeVisible();
  await page.getByLabel("API key").fill("test-key");
  await page.getByText("I understand that excerpts").click();
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("key ending …-key")).toBeVisible();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Connected. 127.0.0.1:4012 answered")).toBeVisible();
  expect(await page.content()).not.toContain("test-key"); // the key is never sent back to the browser
  await page.goto(`${courseUrl}/practice`);
  await expect(page.getByTestId("ai-usage")).toContainText("Using your own provider at 127.0.0.1:4012 (mock-1).");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Remove provider" }).click();
  await expect(page.getByText("key ending")).toHaveCount(0); // the saved key is gone
  await expect(page.getByTestId("managed-ai")).toContainText("Ready");
  await page.goto(`${courseUrl}/practice`);
  await expect(page.getByTestId("ai-usage")).toContainText("Klierly AI is included");
});

test("9. build a study plan that respects date, modules and minutes", async () => {
  await page.goto(`${courseUrl}/plan`);
  await page.getByRole("link", { name: "Use this date and scope" }).first().click();
  await expect(page.getByLabel("Exam date")).toHaveValue("2026-12-04");
  await expect(page.getByRole("checkbox", { name: /Module 4/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Module 1/ })).toBeChecked();
  const d = new Date(Date.now() + 12 * 86400_000);
  const exam = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await page.getByLabel("Exam date").fill(exam);
  await page.getByLabel("Minutes per day").fill("35");
  await page.getByLabel(/^Target grade/).fill("A-");
  await page.getByRole("button", { name: "Build my study plan" }).click();
  await expect(page.getByText("35 minutes a day · aiming for A-")).toBeVisible();
  await expect(page.getByText("The exam format (question types, length, weights) is not confirmed")).toBeVisible();
  await expect(page.getByText("Today · ")).toBeVisible();
  await expect(page.getByText("Timed mock exam on all covered topics")).toBeVisible();
  const minutes = (await page.locator("ol > li > div > span.tnum").allInnerTexts()).map((t) => parseInt(t, 10));
  expect(minutes.length).toBeGreaterThanOrEqual(8);
  expect(Math.max(...minutes)).toBeLessThanOrEqual(35);
  await expect(page.getByText(/Time-series|Moving averages|Exponential smoothing/i)).toHaveCount(0); // Module 4 is out of scope
});

async function answerCurrent(p: Page): Promise<"right" | "unknown"> {
  const stem = await p.getByTestId("stem").innerText();
  const m = /y-hat = (\d+) \+ (\d+)x\. Predict y when x = (\d+)/.exec(stem);
  if (m) { await p.getByTestId("numeric-input").fill(String(Number(m[1]) + Number(m[2]) * Number(m[3]))); return "right"; }
  if (await p.getByTestId("numeric-input").count()) { await p.getByTestId("numeric-input").fill("1"); return "unknown"; }
  await p.keyboard.press("a");
  await expect(p.getByTestId("choice-0")).toHaveAttribute("aria-checked", "true");
  return "unknown";
}

test("10. drill: scored feedback with explanations and source references; progress changes", async () => {
  await page.goto(`${courseUrl}/progress`);
  await expect(page.getByText("No practice results yet.")).toBeVisible();
  await page.goto(`${courseUrl}/plan`);
  await page.getByRole("button", { name: "Start practice" }).first().click();
  await expect(page.getByTestId("practice-runner")).toBeVisible();
  const total = Number(/of (\d+)/.exec(await page.getByText(/^Question 1 of \d+/).innerText())![1]);
  let verifiedRight = 0, citationHref = "";
  for (let i = 0; i < total; i++) {
    await expect(page.getByTestId("feedback")).toHaveCount(0); // nothing is revealed before answering
    const expectation = await answerCurrent(page);
    await page.keyboard.press("Enter");
    const fb = page.getByTestId("feedback");
    await expect(fb).toBeVisible();
    if (expectation === "right") { await expect(fb).toContainText("Correct"); await expect(page.getByText("Answer verified by calculation")).toBeVisible(); verifiedRight++; }
    else if (await fb.getByText("Not quite").count()) await page.getByRole("button", { name: "Calculation slip" }).click();
    await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
    const cite = page.getByRole("heading", { name: "From your materials" }).locator("..").getByRole("link").first();
    await expect(cite).toBeVisible();
    citationHref = (await cite.getAttribute("href"))!;
    await page.getByTestId("primary").click();
  }
  expect(verifiedRight).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("heading", { name: "Drill results" })).toBeVisible();
  const [right, outOf] = (await page.getByTestId("score").innerText()).split("/").map(Number);
  expect(outOf).toBe(total);
  expect(right).toBeGreaterThanOrEqual(verifiedRight);

  // The citation opens the right document at the cited excerpt.
  await page.goto(citationHref);
  await expect(page.locator("li[aria-current=true]")).toContainText("Cited excerpt");

  await page.goto(`${courseUrl}/plan`);
  await expect(page.getByText("Done", { exact: true }).first()).toBeVisible(); // finishing the practice completed the planned session
  await page.goto(`${courseUrl}/progress`);
  await expect(page.getByTestId("readiness")).toHaveText(/^\d+%$/);
  await expect(page.getByText("This is a heuristic, not a grade prediction.")).toBeVisible();
  await expect(page.getByRole("cell", { name: /^\d+\/\d+$/ }).first()).toBeVisible();
});

test("10b. exam blueprint: topic weights from the materials, gaps filled, exam built to it, targeted follow-up", async () => {
  await page.goto(`${courseUrl}/practice`);
  await page.getByRole("link", { name: "Use the exam blueprint" }).click();
  await expect(page.getByRole("heading", { name: "Practice exam blueprint" })).toBeVisible();
  await expect(page.getByText("It is a study aid, not your instructor's exam design.")).toBeVisible();
  await expect(page.getByText("The real exam format is not confirmed")).toBeVisible();
  const total = Number(await page.getByTestId("bp-total").innerText());
  const planned = (await page.locator("tbody tr td:nth-child(3)").allInnerTexts()).map(Number);
  expect(planned.reduce((a, b) => a + b, 0)).toBe(total);
  expect(planned.every((n) => n >= 1)).toBe(true);
  await expect(page.getByText(/Moving averages|Exponential smoothing/)).toHaveCount(0); // plan scope: Module 4 is not in this exam
  const missingBefore = Number(await page.getByTestId("bp-missing").innerText());
  expect(missingBefore).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Generate the missing questions" }).click();
  await expect(page.locator(".notice-good", { hasText: "toward the blueprint" })).toBeVisible({ timeout: 90_000 });
  expect(Number(await page.getByTestId("bp-missing").innerText())).toBeLessThan(missingBefore);

  await page.getByRole("button", { name: "Start the blueprint exam" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  const n = Number(/of (\d+)/.exec(await page.getByText(/^Question 1 of \d+/).innerText())![1]);
  expect(n).toBeGreaterThanOrEqual(8);
  for (let i = 0; i < 3; i++) { await answerCurrent(page); await page.getByTestId("primary").click(); }
  await page.getByRole("button", { name: "Submit exam" }).click();
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByRole("heading", { name: "Mock exam results" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What to practise next" })).toBeVisible();
  // Weaknesses → targeted follow-up: fresh questions on the weak topics, then a drill on exactly those topics.
  await page.getByRole("button", { name: "Generate fresh questions on these topics" }).click();
  await expect(page.locator(".notice", { hasText: /Added \d+ new question|discarded by the checks|Not enough source material/ })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Drill these topics" }).click();
  await expect(page.getByTestId("practice-runner")).toBeVisible();
  await expect(page.getByText("Drill", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Exit" }).click();
});

test("11. timed mock exam grades only after submission", async () => {
  await page.goto(`${courseUrl}/practice`);
  const exam = page.getByRole("region", { name: "Timed mock exam" });
  await exam.getByLabel("Questions").fill("4");
  await exam.getByLabel("Minutes").fill("5");
  await exam.getByRole("button", { name: "Start exam" }).click();
  await expect(page.getByRole("timer")).toContainText(/[45]:\d\d/);
  await answerCurrent(page);
  await page.getByTestId("primary").click(); // Next
  await expect(page.getByText("Question 2 of 4")).toBeVisible();
  await expect(page.getByTestId("feedback")).toHaveCount(0);
  await expect(page.getByText(/Correct answer|Not quite/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /hint/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Question 1, answered" }).click(); // navigator
  await page.reload(); // answers persist across a reload
  await expect(page.getByRole("button", { name: "Question 1, answered" })).toBeVisible();
  await page.getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByText("3 questions are unanswered and will be marked incorrect.")).toBeVisible();
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByRole("heading", { name: "Mock exam results" })).toBeVisible();
  await expect(page.getByTestId("score")).toHaveText(/^[01]\/4$/);
  await expect(page.getByText("No answer")).toHaveCount(3);
  await expect(page.getByText("Average per question")).toBeVisible();
  // Missed questions are queued for review.
  await page.getByRole("button", { name: "Retry the questions I missed" }).click();
  await expect(page.getByTestId("practice-runner")).toBeVisible();
  await expect(page.getByText("Review mistakes", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Exit" }).click();
  await expect(page.getByText("In progress").first()).toBeVisible();
});

test("12. report a bad question; calculator works", async () => {
  await page.getByRole("link", { name: "Continue" }).first().click();
  await page.getByRole("button", { name: "Calculator" }).click();
  await page.getByLabel("Expression").fill("39.863 + 2.479*20 - 2.998*10");
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByText("59.463").first()).toBeVisible();
  await answerCurrent(page);
  await page.getByTestId("primary").click();
  await page.getByRole("button", { name: "Report a bad question" }).click();
  await page.getByLabel("What is wrong with it?").fill("Ambiguous wording");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Reported. This question will not be shown again.")).toBeVisible();
  await page.getByRole("link", { name: "Exit" }).click();
  await expect(page.getByText("1 reported question is excluded from practice.")).toBeVisible();
});

test("13. another user cannot see this course; the sample course works without an AI key", async ({ browser }) => {
  const other = await (await browser.newContext()).newPage();
  watch(other);
  await register(other, "Other Student", "other@e2e.test");
  for (const p of ["", "/materials", "/practice", "/plan", "/progress"]) expect((await other.goto(courseUrl + p))!.status()).toBe(404);
  const docHref = await page.goto(`${courseUrl}/materials`).then(() => page.getByRole("link", { name: "Module 1: Simple Linear Regression" }).first().getAttribute("href"));
  expect((await other.goto(docHref!))!.status()).toBe(404);
  const docId = docHref!.split("/").pop()!;
  expect((await other.request.get(`/api/documents/${docId}/file`)).status()).toBe(404);
  expect((await page.request.get(`/api/documents/${docId}/file`)).headers()["content-disposition"]).toContain("attachment");
  const cross = await other.request.post(`${courseUrl.replace(/^.*\/courses/, "/api/courses")}/upload`, { headers: { origin: "http://localhost:3100" }, multipart: { permission: "yes", file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("some text to import here") } } });
  expect(cross.status()).toBe(404);
  const csrf = await page.request.post(`${courseUrl.replace(/^.*\/courses/, "/api/courses")}/upload`, { headers: { origin: "https://evil.example" }, multipart: { permission: "yes", file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("some text to import here") } } });
  expect(csrf.status()).toBe(403);

  await other.goto("/");
  await other.getByRole("button", { name: "Load the sample course" }).click();
  await other.waitForURL(/\/courses\/[0-9a-f-]+$/, { timeout: 90_000 });
  await expect(other.getByText("Synthetic sample").first()).toBeVisible();
  await other.getByRole("link", { name: "Practice", exact: true }).click();
  await expect(other.getByText("35 questions in this course")).toBeVisible();
  await expect(other.getByTestId("ai-usage")).toContainText("Klierly AI is included");
  expect((await other.goto("/admin"))!.status()).toBe(404); // operator page is not visible to students
  await other.goBack();
  await other.getByRole("button", { name: "Start drill" }).click();
  await expect(other.getByTestId("stem")).toBeVisible();
  await other.close();
});

test("14. responsive layout and dark mode render", async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${courseUrl}/practice`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto(`${courseUrl}/materials`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); // persists without a flash
  await page.getByRole("button", { name: "Switch to light mode" }).click();
});

test("15. delete a source, the course and the account", async () => {
  await page.goto(`${courseUrl}/materials`);
  await page.getByRole("button", { name: "Delete Module 4: Time-Series Forecasting" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete source" }).click();
  await expect(page.getByRole("link", { name: "Module 4: Time-Series Forecasting" })).toHaveCount(0);
  await page.goto(`${courseUrl}/settings`);
  await page.getByRole("button", { name: "Delete course" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete course" }).click();
  await page.waitForURL("/");
  await expect(page.getByText("Start with your own course")).toBeVisible();
  expect((await page.goto(courseUrl))!.status()).toBe(404);
  await page.goto("/settings");
  await page.getByLabel("Confirm with your password").fill("wrong-password");
  await page.getByRole("button", { name: "Delete my account and all data" }).click();
  await expect(page.getByText("That password is not correct. Nothing was deleted.")).toBeVisible();
  await page.getByLabel("Confirm with your password").fill("e2e-password-12345");
  await page.getByRole("button", { name: "Delete my account and all data" }).click();
  await page.waitForURL(/\/login$/);
  await page.getByLabel("Email").fill("founder@e2e.test"); await page.getByLabel("Password").fill("e2e-password-12345");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Email or password is incorrect.");
});
