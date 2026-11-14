/**
 * Deterministic OpenAI-compatible test server. NOT an AI: it builds
 * structurally valid (and some deliberately invalid) output from the
 * <source> excerpts it is sent, so the generation pipeline, validators and
 * retry logic can be tested without a paid provider.
 *
 *   npm run mock-llm            → http://127.0.0.1:4010/v1   (API key: test-key)
 *
 * Model IDs: "mock-1" (normal), "mock-insufficient", "mock-garbage".
 */
import http from "node:http";

export const MOCK_KEY = "test-key";

type Source = { id: string; text: string };

function parseSources(prompt: string): Source[] {
  return [...prompt.matchAll(/<source id="(S\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/g)].map((m) => ({ id: m[1], text: m[2] }));
}

function sentences(src: Source[]): { id: string; s: string }[] {
  const out: { id: string; s: string }[] = [];
  for (const { id, text } of src) {
    for (const s of text.split(/(?<=[.!?])\s+|\n+/)) {
      const t = s.trim();
      const words = t.split(/\s+/).length;
      if (words >= 9 && words <= 40 && !t.includes("|") && /^[A-Z]/.test(t) && /[.!?]$/.test(t)) out.push({ id, s: t });
    }
  }
  return out;
}

const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

function questions(prompt: string) {
  const topic = /^Topic: (.*)$/m.exec(prompt)?.[1] ?? "topic";
  const count = Number(/^Write (\d+) questions/m.exec(prompt)?.[1] ?? 3);
  const retry = prompt.includes("Your previous attempt had problems");
  const avoid = prompt.split("Already in the question bank")[1]?.split("<sources>")[0] ?? "";
  const src = parseSources(prompt);
  const pool = sentences(src).filter((x) => !avoid.includes(x.s.split(/\s+/).slice(0, 5).join(" ")));
  if (pool.length < 4) return { insufficient: true, reason: "The excerpts are too short to write distinct questions.", questions: [] };
  const out: unknown[] = [];
  if (!retry) {
    // Deliberately invalid items: the app must reject both.
    out.push({ type: "numeric", stem: `[mock] A fitted line is y-hat = 4 + 3x. Predict y when x = 5 (${topic}).`, answer: 99, unit: "",
      check: { fn: "regression_predict", args: { intercept: 4, coefficients: [3], values: [5] } }, hint: "Substitute.", explanation: "Deliberately wrong arithmetic for testing.",
      citations: [{ source: src[0].id, quote: pool[0].s }], grounding: "direct", difficulty: 1 });
    out.push({ type: "mcq", stem: `[mock] Which claim about ${topic} cites a source that was never provided?`, choices: ["Alpha claim", "Beta claim", "Gamma claim", "Delta claim"], correctIndex: 1,
      hint: "None.", explanation: "Deliberately cites a non-existent source for testing.", citations: [{ source: "S99", quote: "This quote does not exist anywhere." }], grounding: "direct", difficulty: 1 });
  }
  const seed = hash(topic);
  const a = 10 + (seed % 20), b = 2 + (seed % 5), x = 3 + (seed % 7);
  out.push({ type: "numeric", stem: `[mock] For the topic "${topic}", a fitted line is y-hat = ${a} + ${b}x. Predict y when x = ${x}.`, answer: a + b * x, unit: "",
    check: { fn: "regression_predict", args: { intercept: a, coefficients: [b], values: [x] } }, hint: "Substitute x into the equation.",
    explanation: `${a} + ${b}(${x}) = ${a + b * x}.`, citations: [{ source: pool[0].id, quote: pool[0].s }], grounding: "extrapolated", difficulty: 1 });
  for (let i = 0; out.length < count + (retry ? 0 : 2) && i < pool.length; i++) {
    const { id, s } = pool[i];
    const words = s.split(/\s+/);
    const cut = Math.min(6, Math.floor(words.length / 2));
    const ending = (w: string[]) => w.slice(Math.min(6, Math.floor(w.length / 2))).join(" ");
    const others = pool.filter((_, j) => j !== i).map((o) => ending(o.s.split(/\s+/))).filter((e, j, arr) => arr.indexOf(e) === j && e !== ending(words)).slice(i % 2, (i % 2) + 3);
    if (others.length < 3) continue;
    out.push({ type: "mcq", stem: `[mock] In your notes on "${topic}", which ending correctly completes the sentence that begins “${words.slice(0, cut).join(" ")} …”?`,
      choices: [ending(words), ...others], correctIndex: 0, hint: "Recall how the idea was stated.", explanation: `The source states: "${s}"`,
      citations: [{ source: id, quote: s }], grounding: "direct", difficulty: 2 });
  }
  return { insufficient: false, reason: "", questions: out };
}

function learnNote(prompt: string) {
  const pool = sentences(parseSources(prompt));
  if (pool.length < 2) return { insufficient: true, reason: "Not enough material.", summary: "", keyPoints: [] };
  return { insufficient: false, reason: "", summary: `[mock] ${pool[0].s}`,
    keyPoints: [...pool.slice(0, 3).map((p) => ({ text: `[mock] ${p.s}`, citations: [{ source: p.id, quote: p.s }] })),
      { text: "[mock] An uncited claim that must be dropped.", citations: [{ source: "S42", quote: "nowhere" }] }] };
}

function topics(prompt: string) {
  const pool = sentences(parseSources(prompt));
  if (pool.length < 3) return { insufficient: true, reason: "Not enough material.", topics: [] };
  const name = (s: string) => s.replace(/[^A-Za-z0-9\- ]/g, "").split(/\s+/).slice(0, 4).join(" ");
  return { insufficient: false, reason: "", topics: [
    ...pool.filter((_, i) => i % Math.max(1, Math.floor(pool.length / 5)) === 0).slice(0, 5).map((p) => ({ name: name(p.s), module: null, sources: [p.id] })),
    { name: "Plan", module: null, sources: [pool[0].id] },                         // a bare label: must be dropped
    { name: "Quantum blockchain zebras", module: null, sources: [pool[0].id] },    // not in the material: must be dropped
    { name: name(pool[1].s) + " again", module: null, sources: ["S99"] },          // cites a source that was not provided: must be dropped
  ] };
}

function supplement(prompt: string) {
  const pool = sentences(parseSources(prompt));
  if (pool.length < 2) return { covered: "The sources are too thin to tell what the course covers here.", gaps: [{ point: "General background", explanation: "[mock] A general explanation written for testing, not from any course." }], verify: [] };
  return { covered: `[mock] The notes say: ${pool[0].s}`, gaps: [{ point: "[mock] A prerequisite idea", explanation: "[mock] This is general background knowledge written by the test server, deliberately not found in the course material." }, { point: "[mock] A common mistake", explanation: "[mock] Students often confuse the quantity being tested with the quantity being estimated." }], verify: ["[mock] Check the notation your instructor uses for this test."] };
}

export function startMockLlm(port = 4010): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) return send(404, { error: { message: "not found" } });
    if (req.headers.authorization !== `Bearer ${MOCK_KEY}`) return send(401, { error: { message: "invalid api key" } });
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body: { model?: string; messages?: { role: string; content: string }[] };
      try { body = JSON.parse(raw); } catch { return send(400, { error: { message: "bad json" } }); }
      const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
      const user = body.messages?.filter((m) => m.role === "user").map((m) => m.content).join("\n") ?? "";
      let content: string;
      if (body.model === "mock-missing") return send(404, { error: { message: "model not found" } });
      if (body.model === "mock-garbage") content = "Sure! Here are some questions: 1) What is regression?";
      else if (body.model === "mock-insufficient" && system.includes("JSON")) content = JSON.stringify({ insufficient: true, reason: "The sources do not cover this topic.", questions: [], summary: "", keyPoints: [] });
      else if (system.includes("practice questions")) content = "```json\n" + JSON.stringify(questions(user)) + "\n```";
      else if (system.includes("study note")) content = JSON.stringify(learnNote(user));
      else if (system.includes("fill gaps")) content = JSON.stringify(supplement(user));
      else if (system.includes("study topics")) content = JSON.stringify(topics(user));
      else content = "ok";
      send(200, { id: "mock", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: Math.ceil((system.length + user.length) / 4), completion_tokens: Math.ceil(content.length / 4) } });
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1]?.endsWith("mock-llm.ts")) {
  const port = Number(process.env.MOCK_LLM_PORT ?? 4010);
  void startMockLlm(port).then(() => console.log(`Mock OpenAI-compatible server: http://127.0.0.1:${port}/v1  (API key: ${MOCK_KEY}, model: mock-1)`));
}
