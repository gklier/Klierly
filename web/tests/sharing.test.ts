import fs from "node:fs/promises";
import path from "node:path";
import type http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, getPool, schema } from "@/db";
import { generateSummary } from "@/lib/ai/generate";
import { classAccessForCourse, joinClass, leaveClass, libraryFor, moderate, reportItem, setClassSharing, shareSummary, SharingError, unshareItem } from "@/lib/classes";
import { deleteAccount } from "@/lib/courses";
import { createSource } from "@/lib/ingest/pipeline";
import { resetRateLimits } from "@/lib/ratelimit";
import { parseClassIdentity } from "@/lib/sharing-rules";
import { MOCK_KEY, startMockLlm } from "../scripts/mock-llm";
import { FIXTURES, makeCourse, makeUser, prepareDb, waitForDocument } from "./helpers";

const PORT = 4013;
const SAMPLE = path.join(FIXTURES, "qmb-sample");
let llm: http.Server;
const users: Awaited<ReturnType<typeof makeUser>>[] = [];
const ident = (id = "424242", host = "ufl.instructure.com") => parseClassIdentity({ lms: "canvas", host, externalCourseId: id, label: "ISM3004 – Fall 2026" })!;
const ai = (model = "mock-cheap") => Object.assign(process.env, {
  MANAGED_AI_BASE_URL: `http://127.0.0.1:${PORT}/v1`, MANAGED_AI_API_KEY: MOCK_KEY, MANAGED_AI_MODEL: model,
  MANAGED_AI_PRICE_IN_PER_MTOK: "0.5", MANAGED_AI_PRICE_OUT_PER_MTOK: "2", MANAGED_AI_GLOBAL_MONTHLY_USD: "10",
  MANAGED_AI_USER_DAILY_REQUESTS: "100", MANAGED_AI_USER_MONTHLY_TOKENS: "900000", MANAGED_AI_GLOBAL_DAILY_REQUESTS: "900",
});
const upload = async (userId: string, courseId: string, file: string, title = file) =>
  createSource({ userId, courseId, moduleId: null, kind: "file", title, filename: file, mime: null, data: await fs.readFile(path.join(SAMPLE, file)), originUrl: null });
const student = async (tag: string) => { const u = await makeUser(tag); users.push(u); return u; };
const rejects = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

beforeAll(async () => { await prepareDb(); llm = await startMockLlm(PORT); resetRateLimits(); }, 60_000);
afterAll(async () => {
  for (const u of users) await deleteAccount(u.id);
  for (const k of Object.keys(process.env)) if (k.startsWith("MANAGED_AI_")) delete process.env[k];
  llm.close(); await getPool().end();
});

describe("class library", () => {
  let ann: typeof users[number], ben: typeof users[number], cy: typeof users[number], dee: typeof users[number];
  let annCourse: string, benCourse: string, cyCourse: string, deeCourse: string, annDoc: string, itemId: string;

  beforeAll(async () => {
    [ann, ben, cy, dee] = [await student("ann"), await student("ben"), await student("cy"), await student("dee")];
    [annCourse, benCourse, cyCourse, deeCourse] = (await Promise.all([ann, ben, cy, dee].map((u) => makeCourse(u.id, "ISM3004")))).map((c) => c.id);
    annDoc = (await upload(ann.id, annCourse, "module4-forecasting.md")).documentId;
    await waitForDocument(annDoc);
  }, 60_000);

  it("joining twice is harmless and two students land in the same class", async () => {
    const a = await joinClass(ann.id, ident(), annCourse);
    const again = await joinClass(ann.id, ident(), annCourse);
    const b = await joinClass(ben.id, ident(), benCourse);
    expect(a.linked).toBe(true);
    expect(new Set([a.classId, again.classId, b.classId]).size).toBe(1);
    expect(await db.select().from(schema.classMembers).where(eq(schema.classMembers.classId, a.classId))).toHaveLength(2);
    expect((await classAccessForCourse(ann.id, annCourse))!.active).toBe(false);
    expect((await libraryFor(ann.id, annCourse)).items).toEqual([]);
    await db.update(schema.classMembers).set({ approved: true }).where(eq(schema.classMembers.classId, a.classId));
    await setClassSharing(a.classId, true);
    const cyClass = await joinClass(cy.id, ident("999999"), cyCourse);
    await db.update(schema.classMembers).set({ approved: true }).where(eq(schema.classMembers.classId, cyClass.classId));
    await setClassSharing(cyClass.classId, true); // a different class
    expect((await classAccessForCourse(cy.id, cyCourse))!.classId).not.toBe(a.classId);
    expect((await joinClass(dee.id, ident(), "00000000-0000-0000-0000-000000000000")).linked).toBe(false); // someone else's / unknown course is never linked
    expect(await classAccessForCourse(dee.id, deeCourse)).toBeNull();
  });

  it("a summary is private and cites real excerpts; copying the source wording is refused", async () => {
    ai();
    expect(await generateSummary({ userId: ann.id, courseId: annCourse, documentId: annDoc })).toEqual({ ok: true });
    const [s] = await db.select().from(schema.sourceSummaries).where(eq(schema.sourceSummaries.documentId, annDoc));
    expect(s.body.points.length).toBeGreaterThanOrEqual(3);
    expect(s.body.points.every((p) => p.text.length > 15)).toBe(true);
    expect(await db.select().from(schema.sharedItems)).toEqual(expect.not.arrayContaining([expect.objectContaining({ authorUserId: ann.id })])); // nothing shared yet
    resetRateLimits();
    ai("mock-copycat");
    await db.delete(schema.sourceSummaries).where(eq(schema.sourceSummaries.documentId, annDoc));
    await expect(generateSummary({ userId: ann.id, courseId: annCourse, documentId: annDoc })).rejects.toMatchObject({ code: "bad_output" });
    expect(await db.select().from(schema.sourceSummaries).where(eq(schema.sourceSummaries.documentId, annDoc))).toHaveLength(0);
    ai(); resetRateLimits();
    expect(await generateSummary({ userId: ann.id, courseId: annCourse, documentId: annDoc })).toEqual({ ok: true });
  }, 60_000);

  it("sharing needs a summary, a linked course and a current claim, and never an exam-looking source", async () => {
    await rejects(shareSummary(cy.id, cyCourse, annDoc), "not_found"); // not their document
    await rejects(shareSummary(dee.id, deeCourse, annDoc), "not_linked");
    const stale = await upload(ann.id, annCourse, "module1-simple-regression.pdf", "Midterm 2 answer key");
    await waitForDocument(stale.documentId);
    ai(); resetRateLimits();
    await generateSummary({ userId: ann.id, courseId: annCourse, documentId: stale.documentId });
    await rejects(shareSummary(ann.id, annCourse, stale.documentId), "assessment");
    expect(await db.select().from(schema.sharedItems).where(eq(schema.sharedItems.authorUserId, ann.id))).toHaveLength(0);

    const old = new Date(Date.now() - 200 * 86400_000);
    await db.update(schema.classMembers).set({ verifiedAt: old }).where(eq(schema.classMembers.userId, ann.id));
    await rejects(shareSummary(ann.id, annCourse, annDoc), "stale");
    await joinClass(ann.id, ident()); // opening the course again refreshes the claim
    itemId = await shareSummary(ann.id, annCourse, annDoc);
    expect(itemId).toBeTruthy();
  }, 60_000);

  it("a shared item carries the summary only: no source text, no file name, no author", async () => {
    const [item] = await db.select().from(schema.sharedItems).where(eq(schema.sharedItems.id, itemId));
    const chunks = await db.select({ text: schema.sourceChunks.text }).from(schema.sourceChunks).where(eq(schema.sourceChunks.documentId, annDoc));
    const blob = JSON.stringify(item.body);
    for (const c of chunks) expect(blob).not.toContain(c.text.slice(0, 60));
    expect(item.title).toBe("Module 4: Time-Series Forecasting");
    expect(blob + item.title).not.toContain("module4-forecasting.md");
    expect(item.termsVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const lib = await libraryFor(ben.id, benCourse);
    expect(lib.items.map((i) => i.id)).toEqual([itemId]);
    expect(JSON.stringify(lib.items)).not.toMatch(new RegExp(ann.id + "|" + ann.email));
    expect(lib.items[0].mine).toBe(false);
    expect((await libraryFor(ann.id, annCourse)).items[0].mine).toBe(true);
  });

  it("only members of that class can read it", async () => {
    expect((await libraryFor(cy.id, cyCourse)).items).toHaveLength(0); // member of a different class
    expect(await libraryFor(dee.id, deeCourse)).toMatchObject({ access: null, items: [] }); // not in any class
    await db.update(schema.classMembers).set({ verifiedAt: new Date(Date.now() - 200 * 86400_000) }).where(eq(schema.classMembers.userId, ben.id));
    expect((await libraryFor(ben.id, benCourse)).items).toHaveLength(0); // lapsed claim hides the library until refreshed
    await joinClass(ben.id, ident());
    expect((await libraryFor(ben.id, benCourse)).items).toHaveLength(1);
  });

  it("two different classmates' reports hide an item; the author and outsiders cannot report; the operator can restore", async () => {
    await rejects(reportItem(ann.id, annCourse, itemId, "x"), "own");
    await rejects(reportItem(cy.id, cyCourse, itemId, "x"), "not_found"); // other class cannot even see it
    expect(await reportItem(ben.id, benCourse, itemId, "copies the lecture")).toEqual({ hidden: false });
    expect(await reportItem(ben.id, benCourse, itemId, "again")).toEqual({ hidden: false }); // same person twice is one report
    const eve = await student("eve"); const eveCourse = (await makeCourse(eve.id, "ISM3004")).id;
    await joinClass(eve.id, ident(), eveCourse);
    await db.update(schema.classMembers).set({ approved: true }).where(eq(schema.classMembers.userId, eve.id));
    expect(await reportItem(eve.id, eveCourse, itemId, "exam content")).toEqual({ hidden: true });
    expect((await libraryFor(ben.id, benCourse)).items).toHaveLength(0);
    await moderate(itemId, "restore");
    expect((await libraryFor(ben.id, benCourse)).items).toHaveLength(1);
    expect(await db.select().from(schema.sharedReports).where(eq(schema.sharedReports.itemId, itemId))).toHaveLength(0);
  });

  it("the operator can switch a class off, and the author can take an item down", async () => {
    const { classId } = (await classAccessForCourse(ann.id, annCourse))!;
    await setClassSharing(classId, false);
    expect((await libraryFor(ben.id, benCourse)).items).toHaveLength(0);
    await rejects(shareSummary(ann.id, annCourse, annDoc), "disabled");
    await setClassSharing(classId, true);
    await unshareItem(ben.id, itemId); // someone else's item: nothing happens
    expect((await libraryFor(ben.id, benCourse)).items).toHaveLength(1);
    await unshareItem(ann.id, itemId);
    expect((await libraryFor(ben.id, benCourse)).items).toHaveLength(0);
    expect(await db.select().from(schema.sourceSummaries).where(eq(schema.sourceSummaries.documentId, annDoc))).toHaveLength(1); // private copy stays
  });

  it("leaving a class takes down what you shared and unlinks your courses; deleting the account does too", async () => {
    const { classId } = (await classAccessForCourse(ann.id, annCourse))!;
    const first = await shareSummary(ann.id, annCourse, annDoc);
    await leaveClass(ann.id, classId);
    expect(await db.select().from(schema.sharedItems).where(eq(schema.sharedItems.id, first))).toHaveLength(0);
    expect(await classAccessForCourse(ann.id, annCourse)).toBeNull();
    await rejects(shareSummary(ann.id, annCourse, annDoc), "not_linked");
    await joinClass(ann.id, ident(), annCourse);
    await db.update(schema.classMembers).set({ approved: true }).where(eq(schema.classMembers.userId, ann.id));
    const second = await shareSummary(ann.id, annCourse, annDoc);
    await deleteAccount(ann.id);
    expect(await db.select().from(schema.sharedItems).where(eq(schema.sharedItems.id, second))).toHaveLength(0);
    users.splice(users.indexOf(ann), 1);
    expect(await db.select().from(schema.classMembers).where(and(eq(schema.classMembers.userId, ann.id)))).toHaveLength(0);
  });
});

it("SharingError carries a code", () => { expect(new SharingError("x", "m").code).toBe("x"); });
