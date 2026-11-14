import { NextResponse } from "next/server";

const EXT_ORIGIN = /^(chrome-extension|moz-extension):\/\/[a-z0-9-]+$/i;

/** CORS for the browser extension only: no cookies, bearer token required, extension origins only. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!EXT_ORIGIN.test(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600", Vary: "Origin" };
}

export const preflight = (req: Request) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });

export const extError = (req: Request, status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status, headers: corsHeaders(req) });

/** Resource ids from the extension are opaque labels: bounded length, printable characters only. */
export function externalIdOf(value: unknown): string | null {
  return typeof value === "string" && /^[\w.:\-\/]{3,300}$/.test(value) ? value : null;
}
