import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { startMockCanvas, type MockCanvas } from "./mock-canvas";

/**
 * Course discovery E2E: real extension + real Klierly web app + a SYNTHETIC
 * mock of a Canvas course site (see mock-canvas.ts). This verifies Klierly's
 * side of the flow. It does not verify compatibility with real Canvas.
 *
 * As in extension.spec.ts, a temp copy of the extension gets a host
 * permission for the mock origin because automation cannot click Chrome's
 * permission prompt; the shipped manifest only declares it as optional.
 */
const EXT_SRC = path.resolve(__dirname, "../../extension");
const LMS = "http://localhost:3300";
const APP = "http://localhost:3100";
let canvas: MockCanvas, ctx: BrowserContext, app: Page, lms: Page, extId = "", token = "", courseId = "", tmp = "";
const imports: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  canvas = await startMockCanvas(3300);
  app = await (await browser.newContext()).newPage();
  await app.goto("/register");
  await app.getByLabel("Name").fill("Discovery Tester"); await app.getByLabel("Email").fill("discover@e2e.test"); await app.getByLabel("Password").fill("e2e-password-12345"); await app.getByLabel("Invite code").fill("e2e-invite");
  await app.getByRole("button", { name: "Create account" }).click();
  await app.waitForURL("/");
  await app.goto("/courses/new");
  await app.getByLabel("Course name").fill("QMB 3250 – discovery test");
  await app.getByRole("button", { name: "Create course" }).click();
  await app.waitForURL(/\/materials$/);
  courseId = /courses\/([0-9a-f-]+)/.exec(app.url())![1];
  await app.goto("/settings");
  await app.getByRole("button", { name: "Create pairing token" }).click();
  token = await app.getByTestId("ext-token").innerText();

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "klierly-ext-"));
  const copy = path.join(tmp, "ext");
  fs.cpSync(EXT_SRC, copy, { recursive: true, filter: (src) => !/node_modules|dist|tests/.test(path.relative(EXT_SRC, src)) });
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const der = publicKey.export({ type: "spki", format: "der" });
  extId = [...createHash("sha256").update(der).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
  const manifest = JSON.parse(fs.readFileSync(path.join(copy, "manifest.json"), "utf8"));
  fs.writeFileSync(path.join(copy, "manifest.json"), JSON.stringify({ ...manifest, key: der.toString("base64"), host_permissions: [`${LMS}/*`, "http://127.0.0.1:3301/*"] }));
  ctx = await chromium.launchPersistentContext(path.join(tmp, "profile"), { channel: "chromium", headless: true, args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`] });
  ctx.on("request", (r) => { if (/\/api\/ext\/import/.test(r.url()) && r.method() === "POST") imports.push(new URL(r.url()).pathname); });

  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html`);
  await options.getByLabel("Klierly server address").fill(APP);
  await options.getByLabel("Pairing token").fill(token);
  await options.getByRole("button", { name: "Save" }).click();
  await expect(options.getByRole("status")).toContainText("Connected to localhost:3100");
  await options.close();

  lms = await ctx.newPage();
  await lms.goto(`${LMS}/login`); // the student signs in to the course site in their own tab
  await expect(lms.getByRole("heading", { name: /mock course home/ })).toBeVisible();
});

test.afterAll(async () => {
  await ctx?.close();
  await new Promise((r) => canvas.server.close(r));
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

declare const chrome: { tabs: { query(q: { url: string }): Promise<{ id?: number }[]> } };
async function lmsTabId(pattern = `${LMS}/*`): Promise<number> {
  const helper = await ctx.newPage();
  await helper.goto(`chrome-extension://${extId}/options.html`);
  const id = await helper.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, pattern);
  await helper.close();
  return id!;
}
const openDiscover = async (pace = 60) => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/discover.html?tabId=${await lmsTabId()}&url=${encodeURIComponent(`${LMS}/courses/77`)}&pace=${pace}`);
  return page;
};
const rowFor = (page: Page, title: string) => page.locator("#run-list li", { hasText: title });

test("the popup offers course discovery on a course site", async () => {
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${await lmsTabId()}`);
  await expect(popup.getByRole("button", { name: "Discover this course" })).toBeVisible();
  await popup.close();
});

test("join the class library: needs the terms ticked, sends only the course identity, and links the Klierly course", async () => {
  const d = await openDiscover();
  const bodies: string[] = [];
  ctx.on("request", (r) => { if (/\/api\/ext\/class$/.test(r.url()) && r.method() === "POST") bodies.push(r.postData() ?? ""); });
  await expect(d.getByRole("button", { name: "Join the class library" })).toBeDisabled();
  await d.locator("#class-terms").check();
  await d.getByRole("button", { name: "Join the class library" }).click();
  await expect(d.locator("#class-status")).toContainText("This Klierly course is now linked to it.");
  expect(bodies).toHaveLength(1);
  const sent = JSON.parse(bodies[0]);
  expect(Object.keys(sent).sort()).toEqual(["courseId", "externalCourseId", "host", "label", "lms", "termsAccepted"]);
  expect(sent).toMatchObject({ lms: "canvas", externalCourseId: "77", courseId });
  await app.goto(`/courses/${courseId}/settings`);
  await expect(app.getByTestId("class-link")).toContainText("Linked to");
  await d.close();
});

test("scan: a structured inventory with reasons for everything that is not offered", async () => {
  const d = await openDiscover();
  await d.getByRole("button", { name: "Scan the Modules page" }).click();
  await expect(d.locator("#found-count")).toContainText("3 modules, 13 items, 6 can be imported");
  await expect(d.getByText("TEMPLATE-MODULE")).toHaveCount(0);
  const m1 = d.locator("section.module", { hasText: "Module 1: Simple Linear Regression" });
  await expect(m1.locator("li", { hasText: "Quiz 1: Simple regression" })).toContainText("Quizzes and exams are never imported.");
  await expect(m1.locator("li", { hasText: "Quiz 1" }).getByRole("checkbox")).toBeDisabled();
  await expect(m1.locator("li", { hasText: "Publisher website" })).toContainText("External website.");
  await expect(m1.locator("li", { hasText: "Read first" })).toHaveCount(0); // sub-headers are structure, not resources
  const m2 = d.locator("section.module", { hasText: "Module 2: Multiple Regression" });
  await expect(m2.locator("li", { hasText: "Homework 2" })).toContainText("Graded work is not imported automatically.");
  await expect(m2.locator("li", { hasText: "Week 2 discussion" })).toContainText("other students’ posts");
  await expect(m2.locator("li", { hasText: "Lecture video player" })).toContainText("Import captions");
  const m3 = d.locator("section.module", { hasText: "Module 3: Indicator Variables" });
  await expect(m3).toContainText("0 of 2 importable");
  await expect(m3.locator("li", { hasText: "Module 3 slides" })).toContainText("Locked or not released yet");
  await expect(d.locator("li .tag", { hasText: /^New$/ })).toHaveCount(6);
  // Scanning read the Modules page only: no item was opened, no LMS API was called, nothing was sent to Klierly.
  expect(canvas.requests.filter((p) => /\/pages\/|\/files\/|\/modules\/items\//.test(p))).toEqual([]);
  expect(canvas.requests.filter((p) => p.startsWith("/api/"))).toEqual([]);
  expect(imports).toEqual([]);
  await d.close();
});

test("select a module range, preview, approve, import with progress and clear failures", async () => {
  const d = await openDiscover();
  await d.getByRole("button", { name: "Scan the Modules page" }).click();
  await d.getByLabel("From module").selectOption({ label: "Module 1: Simple Linear Regression" });
  await d.getByLabel("to module").selectOption({ label: "Module 2: Multiple Regression and Model Building" });
  await d.getByRole("button", { name: "Select this range" }).click();
  await expect(d.locator("#summary")).toContainText("6 items selected from 2 module(s)");
  await expect(d.locator("#skip-list")).toContainText("1 not offered: Quizzes and exams are never imported.");
  await expect(d.getByLabel("Import into Klierly course")).toHaveValue(courseId);
  await expect(d.getByRole("button", { name: "Import selected" })).toBeDisabled(); // not approved yet
  expect(imports).toEqual([]);
  await d.getByLabel(/I am allowed to use the selected material/).check();
  await d.getByRole("button", { name: "Import selected" }).click();

  await expect(d.locator("#run-status")).toContainText("Finished: 4 imported or up to date, 2 could not be imported.", { timeout: 60_000 });
  await expect(rowFor(d, "Module 1 overview")).toContainText("Imported");
  await expect(rowFor(d, "Module 1 notes (PDF)")).toContainText("Imported");
  await expect(rowFor(d, "Module 2 notes (Word)")).toContainText("Imported");
  await expect(rowFor(d, "Lecture 2 recording")).toContainText("Not imported");
  await expect(rowFor(d, "Lecture 2 recording")).toContainText("is a .mp4 type Klierly cannot read");
  await expect(rowFor(d, "Instructor slides (no download)")).toContainText("Canvas offers no download link for this file here.");
  await expect(rowFor(d, "Instructor slides (no download)")).toContainText("download it yourself and upload it in Klierly");
  expect(imports.filter((p) => p === "/api/ext/import")).toHaveLength(2);
  expect(imports.filter((p) => p === "/api/ext/import-file")).toHaveLength(2);
  // Never opened: quiz, assignment, discussion, external tool; never called: the LMS API; never attempted: the disabled download.
  expect(canvas.requests.filter((p) => /quizzes|assignments|discussion_topics|^\/api\/|\/files\/504\/download/.test(p))).toEqual([]);
  expect(canvas.requests.at(-1)).toBe("/courses/77/modules"); // the course tab is returned to the Modules page
  await d.getByRole("button", { name: "Check processing status" }).click();
  await expect(rowFor(d, "Module 1 notes (PDF)")).toContainText("processed", { timeout: 20_000 });

  // In Klierly: four sources, filed under modules named as in the course, with page-level provenance for the PDF.
  await app.goto(`/courses/${courseId}/materials`);
  const sources = app.getByRole("region", { name: /^Sources/ });
  await expect(sources.getByText("Extraction 100%")).toHaveCount(4, { timeout: 20_000 });
  await expect(app.getByRole("heading", { name: "Module 1: Simple Linear Regression", level: 3 })).toBeVisible();
  await expect(app.getByRole("heading", { name: "Module 2: Multiple Regression and Model Building", level: 3 })).toBeVisible();
  await expect(app.getByRole("heading", { name: "Not assigned to a module" })).toHaveCount(0);
  await app.getByLabel("Search your materials").fill("p-value null hypothesis");
  await app.getByRole("button", { name: "Search" }).click();
  await app.getByRole("link", { name: /p\. 2/ }).first().click();
  await expect(app.locator("li[aria-current=true]")).toContainText("p. 2");
  await expect(app.getByText("A p-value is not the probability that the null hypothesis is true").first()).toBeVisible();
  await app.goto(`/courses/${courseId}/materials`);
  await app.getByRole("link", { name: "Module 1 overview", exact: true }).click();
  await expect(app.getByRole("link", { name: `${LMS}/courses/77/pages/module-1-overview` })).toBeVisible();
  await expect(app.getByText("The slope b1 is the estimated change").first()).toBeVisible();
  for (const hidden of ["MOCK-HIDDEN-ANSWER-KEY", "MOCK-SIDEBAR-TODO", "MOCK-GLOBAL-NAV-GRADES", "MOCK-FOOTER"]) await expect(app.getByText(hidden)).toHaveCount(0);
  await d.close();
});

test("sync later: imported items are recognised, unchanged ones are not duplicated, a changed page is replaced", async () => {
  canvas.state.version = 2; // the instructor edits "Module 2 overview"
  const d = await openDiscover();
  await d.getByRole("button", { name: "Scan the Modules page" }).click();
  await expect(d.locator("li .tag", { hasText: /^Imported$/ })).toHaveCount(4);
  await expect(d.locator("li .tag", { hasText: /^New$/ })).toHaveCount(2);
  await d.locator("section.module", { hasText: "Module 1: Simple" }).locator("header").getByRole("checkbox").check();
  await d.locator("li", { hasText: "Module 2 overview" }).getByRole("checkbox").check();
  await d.locator("li", { hasText: "Module 2 notes (Word)" }).getByRole("checkbox").check();
  await expect(d.locator("#summary")).toContainText("4 already imported will be re-checked and replaced only if they changed");
  await d.getByLabel(/I am allowed to use the selected material/).check();
  await d.getByRole("button", { name: "Import selected" }).click();
  await expect(d.locator("#run-status")).toContainText("Finished: 4 imported or up to date.", { timeout: 60_000 });
  await expect(d.locator("#run-list .tag", { hasText: "No change" })).toHaveCount(3);
  await expect(rowFor(d, "Module 2 overview")).toContainText("Updated");
  await app.goto(`/courses/${courseId}/materials`);
  await expect(app.getByRole("region", { name: /^Sources/ }).getByText("Extraction 100%")).toHaveCount(4, { timeout: 20_000 }); // still four: no duplicates
  await app.getByRole("link", { name: "Module 2 overview", exact: true }).click();
  await expect(app.getByText("UPDATED-BY-INSTRUCTOR").first()).toBeVisible();
  await d.close();
});

test("stop and resume: finished items stay, the rest continues later", async () => {
  canvas.state.version = 3; // no content difference from v2; items will report "No change"
  let d = await openDiscover(2500);
  await d.getByRole("button", { name: "Scan the Modules page" }).click();
  await d.getByRole("button", { name: "Select this range" }).click(); // default range = all modules
  await d.getByLabel(/I am allowed to use the selected material/).check();
  await d.getByRole("button", { name: "Import selected" }).click();
  await expect(d.locator("#run-list .tag", { hasText: /^(No change|Imported|Updated)/ }).first()).toBeVisible({ timeout: 30_000 });
  await d.getByRole("button", { name: "Stop" }).click();
  await expect(d.locator("#run-status")).toContainText(/Stopped\. [1-5] of 6 handled/, { timeout: 30_000 });
  await d.close();

  d = await openDiscover(60); // reopening the page offers to pick up where it stopped
  await expect(d.locator("#resume-text")).toContainText(/still to do/);
  await d.getByRole("button", { name: "Resume import" }).click();
  await expect(d.locator("#run-status")).toContainText("Finished: 4 imported or up to date, 2 could not be imported.", { timeout: 60_000 });
  await d.reload();
  await expect(d.locator("#resume")).toBeHidden(); // nothing left to resume
  await d.close();
});

test("lecture captions: text tracks on the page and inside an embedded player are imported with timestamps", async () => {
  await lms.goto(`${LMS}/courses/77/pages/lecture-21`);
  await expect(lms.getByRole("heading", { name: "Lecture video" })).toBeVisible();
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${await lmsTabId()}`);
  await expect(popup.getByRole("link", { name: "Import its captions or transcript" })).toBeVisible();
  await popup.close();

  const before = imports.length;
  const c = await ctx.newPage();
  await c.goto(`chrome-extension://${extId}/captions.html?tabId=${await lmsTabId()}`);
  await c.getByRole("button", { name: "Look for captions" }).click();
  await expect(c.locator("#read-status")).toContainText("Found 2 caption sources.", { timeout: 20_000 });
  await expect(c.locator("#found li").first()).toContainText("12 timed captions · from localhost:3300");
  await expect(c.locator("#found li").nth(1)).toContainText("2 timed captions · from 127.0.0.1:3301");
  await expect(c.locator("#found li").nth(1)).toContainText("EMBEDDED-PLAYER-CAPTION");
  await expect(c.getByRole("button", { name: "Import captions" })).toBeDisabled();
  expect(imports.length).toBe(before); // nothing sent before approval
  await c.getByLabel("Title in Klierly").fill("Module 21 lecture");
  await c.getByLabel(/I am allowed to use these captions/).check();
  await c.getByRole("button", { name: "Import captions" }).click();
  await expect(c.locator("#done")).toContainText("Imported 2.");
  await c.close();

  await app.goto(`/courses/${courseId}/materials`);
  await expect(app.getByRole("link", { name: "Module 21 lecture — captions", exact: true })).toBeVisible();
  await expect(app.getByText("VTT", { exact: true })).toHaveCount(2, { timeout: 20_000 });
  await app.getByLabel("Search your materials").fill("Kruskal-Wallis three groups");
  await app.getByRole("button", { name: "Search" }).click();
  await app.getByRole("link", { name: /Module 21 lecture — captions 2 · 0:01/ }).click(); // the citation carries the lecture timestamp
  await expect(app.locator("li[aria-current=true]")).toContainText("The Kruskal-Wallis test extends the idea to three or more groups.");
  await app.goto(`/courses/${courseId}/materials`);
});

test("Mediasite: the lecture transcript is pulled the way the player does, from inside the embedded player", async () => {
  await lms.goto(`${LMS}/courses/77/pages/lecture-22`);
  await expect(lms.getByRole("heading", { name: "Lecture" })).toBeVisible();
  const before = imports.length;
  const c = await ctx.newPage();
  await c.goto(`chrome-extension://${extId}/captions.html?tabId=${await lmsTabId()}`);
  await c.getByRole("button", { name: "Look for captions" }).click();
  await expect(c.locator("#read-status")).toContainText("Found 1 caption source.", { timeout: 20_000 });
  await expect(c.locator("#found li")).toContainText("Mock Mediasite lecture: rank tests — transcript");
  await expect(c.locator("#found li")).toContainText("2 timed captions · from 127.0.0.1:3301");
  await expect(c.locator("#found li")).toContainText("MEDIASITE-TRANSCRIPT-LINE");
  expect(imports.length).toBe(before); // nothing is sent before approval
  // Exactly what the player itself would ask for: one POST naming the presentation, one transcript download, first transcript only.
  expect(canvas.state.mediasite.posts).toEqual([{ resourceId: "abc123", queryString: "?autostart=false", xhr: "XMLHttpRequest" }]);
  expect(canvas.state.mediasite.captionGets).toBe(1);
  await c.getByLabel(/I am allowed to use these captions/).check();
  await c.getByRole("button", { name: "Import captions" }).click();
  await expect(c.locator("#done")).toContainText("Imported 1.");
  await c.close();
  await app.goto(`/courses/${courseId}/materials`);
  await app.getByLabel("Search your materials").fill("Wilcoxon rank sum independent groups");
  await app.getByRole("button", { name: "Search" }).click();
  await app.getByRole("link", { name: /Mock Mediasite lecture: rank tests — transcript · 0:02/ }).click(); // cited by lecture timestamp
  await expect(app.locator("li[aria-current=true]")).toContainText("MEDIASITE-TRANSCRIPT-LINE");
  await app.goto(`/courses/${courseId}/materials`);
});

test("Mediasite: timed-text XML is converted, and a lecture without a transcript says so plainly", async () => {
  await lms.goto("http://127.0.0.1:3301/Mediasite/Play/ttml1"); // the player opened in its own tab
  let c = await ctx.newPage();
  await c.goto(`chrome-extension://${extId}/captions.html?tabId=${await lmsTabId("http://127.0.0.1:3301/*")}`);
  await c.getByRole("button", { name: "Look for captions" }).click();
  await expect(c.locator("#found li")).toContainText("2 timed captions");
  await expect(c.locator("#found li")).toContainText("TTML-LINE ranks replace the raw values & keep their order.");
  await c.close();

  await lms.goto("http://127.0.0.1:3301/Mediasite/Play/none1");
  c = await ctx.newPage();
  await c.goto(`chrome-extension://${extId}/captions.html?tabId=${await lmsTabId("http://127.0.0.1:3301/*")}`);
  await c.getByRole("button", { name: "Look for captions" }).click();
  await expect(c.locator("#fatal")).toContainText("This lecture has no transcript or captions published in Mediasite.");
  await expect(c.locator("#fatal")).toContainText("open the video in its own tab or window");
  await expect(c.getByRole("button", { name: "Import captions" })).toBeHidden();
  await c.close();
  await lms.goto(`${LMS}/courses/77`);
});

test("the extension's run summaries reach the activity log as counts and reasons, never page content", async () => {
  const res = await app.request.get("/api/activity/export");
  const text = await res.text();
  type Details = { host?: string; ok?: boolean; tally?: { failed?: number }; failures: { type: string; reason: string }[]; diag: Record<string, unknown> } & Record<string, unknown>;
  const { events } = JSON.parse(text) as { events: { event: string; source: string; details: Details }[] };
  const scan = events.find((e) => e.event === "extension.discovery.scan" && e.details.ok);
  expect(scan).toMatchObject({ source: "extension" });
  // What a fix for a different Canvas layout would need: structure counts, types, lock state — no titles, no text.
  expect(scan!.details).toMatchObject({ host: "localhost:3300", modules: 3, items: 13, importable: 6, locked: 2, byType: { page: 3, file: 5, quiz: 1 } });
  expect(scan!.details.diag).toMatchObject({ modulesRoot: 1, moduleEls: 4, itemEls: expect.any(Number), titleLinks: expect.any(Number) });
  const run = events.find((e) => e.event === "extension.discovery.run" && e.details.tally?.failed === 2)!;
  expect(run.details.failures.map((f) => f.type).sort()).toEqual(["file", "file"]);
  expect(run.details.failures.map((f) => f.reason).join(" ")).toMatch(/\.mp4 type Klierly cannot read.*no download link/s);
  const cap = events.find((e) => e.event === "extension.captions.read" && e.details.tracks === 2)!;
  expect(cap.details).toMatchObject({ sources: 2, tracks: 2, panels: 0, mediasite: 0 });
  expect(events.some((e) => e.event === "source.created" && e.source === "extension")).toBe(true);
  // Import events carry source titles (course structure); what the extension itself reports carries neither titles nor text.
  const fromExtension = JSON.stringify(events.filter((e) => e.event.startsWith("extension.")));
  for (const never of ["Module 1 overview", "Module 2 notes", "Lecture 2 recording", "Quiz 1: Simple regression", "Mock lecture", "MOCK-QUIZ-CONTENT", "MOCK-HIDDEN-ANSWER-KEY", "EMBEDDED-PLAYER-CAPTION", "The slope b1 is the estimated change"]) expect(fromExtension.includes(never), never).toBe(false);
  for (const never of ["Quiz 1: Simple regression", "MOCK-QUIZ-CONTENT", "MOCK-HIDDEN-ANSWER-KEY", "EMBEDDED-PLAYER-CAPTION", "The slope b1 is the estimated change"]) expect(text.includes(never), never).toBe(false);
  // The endpoint refuses anything that is not a known run summary.
  const bad = await app.request.post("/api/ext/log", { headers: { Authorization: `Bearer ${token}` }, data: { event: "pwn", details: {} } });
  expect(bad.status()).toBe(400);
  expect((await app.request.post("/api/ext/log", { data: { event: "discovery.scan", details: {} } })).status()).toBe(401);
});

test("server: inventory endpoint needs the pairing token and is scoped to the owner", async ({ request, browser }) => {
  const auth = { Authorization: `Bearer ${token}` };
  const mine = await request.get(`/api/ext/courses/${courseId}/sources`, { headers: auth });
  expect(mine.status()).toBe(200);
  const body = await mine.json();
  expect(body.sources).toHaveLength(4);
  expect(body.sources.every((s: { externalId: string; status: string }) => s.externalId.startsWith("canvas:localhost:3300:77:") && s.status === "ready")).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/slope|regression describes/i); // ids and status only, no content
  expect((await request.get(`/api/ext/courses/${courseId}/sources`)).status()).toBe(401);

  const other = await (await browser.newContext()).newPage();
  await other.goto("/register");
  await other.getByLabel("Name").fill("Someone Else"); await other.getByLabel("Email").fill("else@e2e.test"); await other.getByLabel("Password").fill("e2e-password-12345"); await other.getByLabel("Invite code").fill("e2e-invite");
  await other.getByRole("button", { name: "Create account" }).click();
  await other.waitForURL("/");
  await other.goto("/settings");
  await other.getByRole("button", { name: "Create pairing token" }).click();
  const otherAuth = { Authorization: `Bearer ${await other.getByTestId("ext-token").innerText()}` };
  expect((await request.get(`/api/ext/courses/${courseId}/sources`, { headers: otherAuth })).status()).toBe(404);
  const cross = await request.post("/api/ext/import-file", { headers: otherAuth, multipart: { courseId, title: "x", permissionConfirmed: "true", file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("some study text here") } } });
  expect(cross.status()).toBe(404);
  const noDecl = await request.post("/api/ext/import-file", { headers: auth, multipart: { courseId, title: "x", file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("some study text here") } } });
  expect((await noDecl.json()).error.code).toBe("permission_required");
  const exe = await request.post("/api/ext/import-file", { headers: auth, multipart: { courseId, title: "x", permissionConfirmed: "true", file: { name: "a.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") } } });
  expect((await exe.json()).error.code).toBe("unsupported_type");
  await other.close();
});
