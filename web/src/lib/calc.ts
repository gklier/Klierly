/** Small, safe arithmetic evaluator for the practice calculator (no eval). */
const FUNCS: Record<string, (x: number) => number> = { sqrt: Math.sqrt, ln: Math.log, log: Math.log10, exp: Math.exp, abs: Math.abs };

export function evaluate(input: string): number {
  const s = input.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,/g, "");
  if (!s) throw new Error("Empty expression");
  if (s.length > 200) throw new Error("Expression too long");
  let i = 0;
  const peek = () => s[i];
  const expr = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = s[i++]; const r = term(); v = op === "+" ? v + r : v - r; }
    return v;
  };
  const term = (): number => {
    let v = unary();
    while (peek() === "*" || peek() === "/") { const op = s[i++]; const r = unary(); v = op === "*" ? v * r : v / r; }
    return v;
  };
  const unary = (): number => {
    if (peek() === "-") { i++; return -unary(); }
    if (peek() === "+") { i++; return unary(); }
    return power();
  };
  const power = (): number => {
    const base = atom();
    if (peek() === "^") { i++; return Math.pow(base, unary()); }
    return base;
  };
  const atom = (): number => {
    if (peek() === "(") { i++; const v = expr(); if (s[i++] !== ")") throw new Error("Missing )"); return v; }
    const name = /^[a-z]+/i.exec(s.slice(i));
    if (name) {
      const id = name[0].toLowerCase();
      i += id.length;
      if (id === "pi") return Math.PI;
      if (id === "e" && peek() !== "(") return Math.E;
      const fn = FUNCS[id];
      if (!fn || s[i++] !== "(") throw new Error(`Unknown name "${id}"`);
      const v = expr();
      if (s[i++] !== ")") throw new Error("Missing )");
      return fn(v);
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!num) throw new Error("Unexpected input");
    i += num[0].length;
    const v = Number(num[0]);
    return peek() === "%" ? (i++, v / 100) : v;
  };
  const v = expr();
  if (i < s.length) throw new Error("Unexpected input");
  if (!Number.isFinite(v)) throw new Error("Not a finite number");
  return v;
}

export function formatNumber(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e12 || abs < 1e-6) return v.toExponential(6).replace(/\.?0+e/, "e");
  return String(Number(v.toPrecision(10)));
}
