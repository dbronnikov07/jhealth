// The gate in front of the physiotherapist's dashboard (Next.js 16 calls this file "proxy"; it used to be "middleware").
// The browser shows its own sign-in box; any user name works, the password is DASHBOARD_PASSWORD.
// Rules (lib/auth-core.ts): without a password the dashboard opens only on this computer in development; through a
// tunnel or in production it refuses. Every dashboard action and data read checks again (lib/auth.ts): the gate is
// the first line of defence, not the only one.
//
// /test/* holds a research-licensed test video of a real person: only this computer (or a signed-in doctor) may load it.
import { NextResponse, type NextRequest } from "next/server";
import { dashboardAccess, fromThisComputer } from "@/lib/auth-core";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/test/") && fromThisComputer(request.headers)) return NextResponse.next();
  const access = dashboardAccess(request.headers);
  if (access.ok) return NextResponse.next();
  return new NextResponse(access.message, {
    status: access.status,
    headers: access.status === 401 ? { "WWW-Authenticate": 'Basic realm="jHealth dashboard", charset="UTF-8"' } : {},
  });
}

export const config = {
  matcher: ["/doctor/:path*", "/test/:path*"],
};
