import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/login$/, /^\/register$/, /^\/privacy$/, /^\/api\/health$/, /^\/api\/ext\//];

/** Cheap gate: no session cookie → sign-in. Real authorization happens in every page, action and route. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => p.test(pathname)) || req.cookies.has("cl_session")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: { code: "unauthorized", message: "Sign in first." } }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/|favicon|icon|.*\\.(?:png|svg|ico|txt)$).*)"] };
