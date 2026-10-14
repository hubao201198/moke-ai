import { NextRequest, NextResponse } from "next/server";
import { accessProtectionConfigured, sessionCookieName, verifySessionToken } from "./lib/session";

const publicPaths = new Set([
  "/login",
  "/api/health",
  "/api/auth/login",
  "/api/auth/logout",
  "/favicon.svg",
  "/og.png",
]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (publicPaths.has(pathname) || pathname.startsWith("/_next/")) return NextResponse.next();

  if (!accessProtectionConfigured()) {
    const login = new URL("/login", request.url);
    login.searchParams.set("error", "config");
    return NextResponse.redirect(login);
  }

  const authenticated = await verifySessionToken(request.cookies.get(sessionCookieName)?.value);
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "请先登录" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
