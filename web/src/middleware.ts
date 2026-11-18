import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/login$/, /^\/register$/, /^\/enroll$/, /^\/privacy$/, /^\/terms\/sharing$/, /^\/api\/health$/, /^\/api\/ext\//];

/** Cheap gate: no session cookie → sign-in. Real authorization happens in every page, action and route. */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; ");
  const forwarded = new Headers(req.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.set("Content-Security-Policy", csp);
  const { pathname } = req.nextUrl;
  let response: NextResponse;
  if (PUBLIC.some((p) => p.test(pathname)) || (req.cookies.has("__Host-cl_session") || req.cookies.has("cl_session"))) {
    response = NextResponse.next({ request: { headers: forwarded } });
  } else if (pathname.startsWith("/api/")) {
    response = NextResponse.json({ error: { code: "unauthorized", message: "Sign in first." } }, { status: 401 });
  } else {
    response = NextResponse.redirect(new URL("/login", req.url));
  }
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "private, no-store");
  if (process.env.APP_URL?.startsWith("https://")) response.headers.set("Strict-Transport-Security", "max-age=31536000");
  return response;
}

export const config = { matcher: ["/((?!_next/|favicon|icon|.*\\.(?:png|svg|ico|txt)$).*)"] };
