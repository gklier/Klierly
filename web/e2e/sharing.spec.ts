import { enrollTestAccount, approveTestMemberships, testDatabase } from "./passkey-helper";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const FIX = path.resolve(__dirname, "../../fixtures");
const CLASS = { lms: "canvas", host: "ufl.instructure.com", externalCourseId: "777001", label: "ISM3004 – Fall 2026", termsAccepted: true };
const errors: string[] = [];
type Who = { ctx: BrowserContext; page: Page; courseId: string; token: string };
const people: Record<string, Who> = {};

async function signUp(browser: import("@playwright/test").Browser, name: string, email: string): Promise<Who> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await enrollTestAccount(page, name, email);
  return { ctx, page, courseId: "", token: "" };
}

async function makeCourse(w: Who, name: string) {
  await w.page.getByRole("link", { name: "New course" }).first().click();
  await w.page.getByLabel("Course name").fill(name);
  await w.page.getByRole("button", { name: "Create course" }).click();
  await w.page.waitForURL(/\/courses\/[0-9a-f-]+\/materials$/);
  w.courseId = /courses\/([0-9a-f-]+)/.exec(w.page.url())![1];
  await w.page.goto("/settings");
  await w.page.getByLabel("Name for this browser").fill("E2E");
  await w.page.getByRole("button", { name: "Create pairing token" }).click();
  w.token = await w.page.getByTestId("ext-token").innerText();
}

test.describe.configure({ mode: "serial" });
test.afterAll(async () => { for (const w of Object.values(people)) await w.ctx.close(); expect(errors).toEqual([]); });

// Registration is rate limited per address (8 per 10 minutes) and earlier specs already use most of it, so this spec uses two
// accounts: Sam (also the operator) and Rae (who also plays the outsider with a second, unlinked course).
test("two students sign up with the same course name", async ({ browser }) => {
  people.sam = await signUp(browser, "Sam", "operator@e2e.test");
  people.rae = await signUp(browser, "Rae", "rae@share.test");
  const db = await testDatabase();
  try { await db.query("update users set is_admin=true where email='operator@e2e.test'"); } finally { await db.end(); }
  for (const k of ["sam", "rae"]) await makeCourse(people[k], "ISM3004 Business Analytics");
});

test("the library is closed until the student joins through the extension, which needs the terms accepted", async () => {
  const { page, courseId, token } = people.sam;
  await page.goto(`/courses/${courseId}/library`);
  await expect(page.getByText("This course is not linked to a class yet.")).toBeVisible();
  const call = (body: object, tok = token) => page.request.post("/api/ext/class", { headers: { Authorization: `Bearer ${tok}` }, data: body });
  expect((await call({ ...CLASS, termsAccepted: false })).status()).toBe(400);
  expect((await call({ ...CLASS, host: "not a host" })).status()).toBe(400);
  expect((await call({ ...CLASS }, "clx_bogus")).status()).toBe(401);
  expect((await call({ ...CLASS, courseId: "00000000-0000-0000-0000-000000000000" })).status()).toBe(404);
  const ok = await call({ ...CLASS, label: "Modules: ISM3004 – Fall 2026", courseId });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ label: "ISM3004 – Fall 2026", linked: true, sharingEnabled: false });
  for (const k of ["rae"]) {
    const w = people[k];
    expect((await w.page.request.post("/api/ext/class", { headers: { Authorization: `Bearer ${w.token}` }, data: { ...CLASS, courseId: w.courseId } })).status()).toBe(200);
  }
  await approveTestMemberships();
  await page.goto(`/courses/${courseId}/settings`);
  await expect(page.getByTestId("class-link")).toContainText("Linked to ISM3004 – Fall 2026");
});

test("Sam uploads a source, makes a summary in their own words and shares it with consent", async () => {
  const { page, courseId } = people.sam;
  await page.goto(`/courses/${courseId}/materials`);
  await page.getByRole("tabpanel").getByRole("checkbox").check();
  await page.locator("#file-input").setInputFiles(path.join(FIX, "qmb-sample/module4-forecasting.md"));
  const link = page.getByRole("link", { name: "Module 4: Time-Series Forecasting", exact: true });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  const card = page.getByTestId("summary-card");
  await card.getByRole("button", { name: "Create summary" }).click();
  await expect(card.getByText("AI-written, may contain mistakes")).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText("Shared with")).toHaveCount(0); // private until shared
  const share = card.getByRole("button", { name: "Share with class" });
  await share.click();
  await expect(card.getByText("Tick the box to confirm the sharing terms.")).toBeVisible(); // consent is required
  await card.getByRole("checkbox").check();
  await share.click();
  await expect(card.getByText("Shared with ISM3004 – Fall 2026")).toBeVisible({ timeout: 15_000 });
});

test("Rae sees it in the class library, labelled as an AI summary from a classmate, and can report it", async () => {
  const { page, courseId } = people.rae;
  await page.goto(`/courses/${courseId}/library`);
  const item = page.getByTestId("shared-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Module 4: Time-Series Forecasting");
  await expect(item.getByText("AI summary")).toBeVisible();
  await expect(item.getByText("A classmate")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Sam");
  await item.getByText("Report", { exact: true }).click();
  await item.getByLabel("Reason").fill("looks copied");
  await item.getByRole("button", { name: "Send report" }).click();
  await expect(item.getByText("Thanks. It has been reported.")).toBeVisible();
});

test("a course that never joined sees nothing, and nobody can open someone else's course", async () => {
  const { page } = people.rae;
  await page.goto("/");
  await page.getByRole("link", { name: "New course" }).first().click();
  await page.getByLabel("Course name").fill("Some other class");
  await page.getByRole("button", { name: "Create course" }).click();
  await page.waitForURL(/\/courses\/[0-9a-f-]+\/materials$/);
  const other = /courses\/([0-9a-f-]+)/.exec(page.url())![1];
  await page.goto(`/courses/${other}/library`);
  await expect(page.getByText("This course is not linked to a class yet.")).toBeVisible();
  await expect(page.getByTestId("shared-item")).toHaveCount(0);
  expect((await page.goto(`/courses/${people.sam.courseId}/library`))!.status()).toBe(404);
});

test("the operator sees the class and the report, and Sam can take the summary down", async () => {
  const op = people.sam;
  await op.page.goto("/admin");
  const mod = op.page.getByTestId("class-moderation");
  await expect(mod).toContainText("ISM3004 – Fall 2026");
  await expect(mod.getByRole("row", { name: /ISM3004/ })).toContainText("2"); // members who claimed it
  await expect(mod).toContainText("1 report · active"); // one report is below the hide threshold: still visible, but queued for review
  await expect(mod).toContainText("looks copied");
  const raeLib = people.rae.page;
  await mod.getByRole("button", { name: "Hide" }).click();
  await expect(mod).toContainText("1 report · hidden");
  await raeLib.goto(`/courses/${people.rae.courseId}/library`);
  await expect(raeLib.getByTestId("shared-item")).toHaveCount(0); // hidden by the operator
  await mod.getByRole("button", { name: "Restore" }).click();
  await expect(mod).toContainText("Nothing is waiting for review.");
  await raeLib.goto(`/courses/${people.rae.courseId}/library`);
  await expect(raeLib.getByTestId("shared-item")).toHaveCount(1);
  expect((await people.rae.page.goto("/admin"))!.status()).toBe(404); // a student who is not an operator cannot open it

  const { page, courseId } = people.sam;
  await page.goto(`/courses/${courseId}/library`);
  await page.getByTestId("shared-item").getByRole("button", { name: /Take down/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Take down" }).click();
  // The action runs on the server; wait for its effect instead of assuming it already finished.
  await expect(async () => { await page.reload(); await expect(page.getByTestId("shared-item")).toHaveCount(0, { timeout: 2000 }); }).toPass({ timeout: 15_000 });
  await people.rae.page.goto(`/courses/${people.rae.courseId}/library`);
  await expect(people.rae.page.getByTestId("shared-item")).toHaveCount(0);
});

test("the sharing terms are public and say plainly what is and is not checked", async ({ page }) => {
  await page.goto("/terms/sharing");
  await expect(page.getByRole("heading", { name: "Class library terms" })).toBeVisible();
  await expect(page.getByText("Klierly cannot confirm enrolment")).toBeVisible();
  await expect(page.getByText("not been reviewed by a lawyer")).toBeVisible();
});
