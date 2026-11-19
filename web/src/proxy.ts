// The gate in front of the physiotherapist's dashboard (Next.js 16 calls this file "proxy"; it used to be "middleware").
// Rules (lib/auth-core.ts): with DASHBOARD_PASSWORD set, a signed-in session cookie is needed (from /login); without
// it, the dashboard opens only on this computer in development, and through a tunnel or in production it refuses.
// Every dashboard action and data read checks again (lib/auth.ts): the gate is the first line of defence, not the only one.
//
// /test/* holds a research-licensed test video of a real person: only this computer (or a signed-in doctor) may load it.
import { NextResponse, type NextRequest } from "next/server";
import { dashboardAccess, fromThisComputer } from "@/lib/auth-core";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/test/") && fromThisComputer(request.headers)) return NextResponse.next();
  const access = dashboardAccess(request.headers);
  if (access.ok) return NextResponse.next();

  // A person opening a dashboard page goes to the sign-in page, and comes back here afterwards.
  if (access.status === 401 && request.method === "GET" && path.startsWith("/doctor")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(login, 303);
  }
  return new NextResponse(access.message, { status: access.status, headers: { "Cache-Control": "no-store" } });
}

export const config = {
  matcher: ["/doctor/:path*", "/test/:path*"],
};
