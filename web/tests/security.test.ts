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
