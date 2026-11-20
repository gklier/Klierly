import { describe, expect, it } from "vitest";
import { checkBaseUrl } from "@/lib/ai/provider";
import { boundedRequest } from "@/lib/request-body";

describe("hosted provider boundary", () => {
  it("rejects DNS aliases, IPv6 private addresses, alternate ports, and endpoint paths", () => {
    const previous = process.env.ALLOW_PRIVATE_AI_ENDPOINTS;
    process.env.ALLOW_PRIVATE_AI_ENDPOINTS = "false";
    try {
      for (const url of ["https://attacker.example/v1", "https://[::ffff:10.10.23.3]/v1", "https://[fe80::1]/v1", "https://api.openai.com:8443/v1", "https://api.openai.com/v1/other", "https://api.openai.com/v1?key=secret", "https://api.openai.com.evil.example/v1"]) {
        expect(checkBaseUrl(url).ok, url).toBe(false);
      }
      expect(checkBaseUrl("https://generativelanguage.googleapis.com/v1beta/openai/")).toEqual({ ok: true, url: "https://generativelanguage.googleapis.com/v1beta/openai" });
    } finally { process.env.ALLOW_PRIVATE_AI_ENDPOINTS = previous; }
  });
});

describe("bounded request parsing", () => {
  it("rejects a chunked body when actual bytes exceed the limit", async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8)); controller.close(); } });
    const req = new Request("http://localhost/import", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(boundedRequest(req, 10)).rejects.toThrow("body_too_large");
  });
  it("rejects dishonest declared lengths and preserves valid multipart parsing", async () => {
    await expect(boundedRequest(new Request("http://localhost/import", { method: "POST", headers: { "Content-Length": "9999" }, body: "short" }), 10)).rejects.toThrow();
    const form = new FormData();
    form.set("title", "Study notes");
    const req = await boundedRequest(new Request("http://localhost/import", { method: "POST", body: form }), 4096);
    expect((await req.formData()).get("title")).toBe("Study notes");
  });
});

// Storage reservations must serialize across simultaneous imports, including
// requests arriving through different import endpoints.
import { beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, getPool, schema } from "@/db";
import { prepareDb, makeUser, makeCourse } from "./helpers";
import { createSource } from "@/lib/ingest/pipeline";
import { deleteAccount } from "@/lib/courses";
let quotaUser: string;
beforeAll(async () => { await prepareDb(); }, 60_000);
afterAll(async () => { if (quotaUser) await deleteAccount(quotaUser); await getPool().end(); });
it("reserves per-user storage under concurrent imports", async () => {
  const user = await makeUser("quota-test");
  quotaUser = user.id;
  const course = await makeCourse(user.id);
  const input = { userId: user.id, courseId: course.id, moduleId: null, kind: "paste" as const, mime: "text/plain", originUrl: null };
  const existing = await createSource({ ...input, title: "Existing", filename: "existing.txt", data: Buffer.from("existing material for the test") });
  await db.update(schema.sourceDocuments).set({ sizeBytes: 512 * 1048576 - 150 }).where(eq(schema.sourceDocuments.id, existing.documentId));
  const results = await Promise.allSettled([
    createSource({ ...input, title: "One", filename: "one.txt", data: Buffer.from("a".repeat(100)) }),
    createSource({ ...input, title: "Two", filename: "two.txt", data: Buffer.from("b".repeat(100)) }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ code: "storage_limit" });
});

import { confirmationScope, validConfirmationScope } from "@/lib/approval-scope";
it("binds passkey approval to the operation and exact target", async () => {
  const form = new FormData();
  form.set("userId", "first-user"); form.set("disabled", "true");
  const scope = await confirmationScope("account-disable", form);
  expect(validConfirmationScope(scope)).toBe(true);
  expect(validConfirmationScope(`${scope}:extra`)).toBe(false);
  form.set("userId", "second-user");
  expect(await confirmationScope("account-disable", form)).not.toBe(scope);
  expect(await confirmationScope("account-recover", form)).not.toBe(scope);
  expect(validConfirmationScope("admin")).toBe(false);
});
