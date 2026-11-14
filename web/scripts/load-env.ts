import fs from "node:fs";
import path from "node:path";

/** Minimal .env loader for scripts (Next.js loads these itself for the app). */
export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.resolve(__dirname, "..", f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
