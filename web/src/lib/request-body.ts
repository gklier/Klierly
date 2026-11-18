/** Buffer only a bounded body, including requests without Content-Length. */
export async function boundedRequest(req: Request, maximumBytes: number): Promise<Request> {
  const declared = req.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) throw new Error("body_too_large");
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maximumBytes) { await reader.cancel(); throw new Error("body_too_large"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  return new Request(req.url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks), signal: req.signal });
}
