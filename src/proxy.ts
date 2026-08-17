import { NextResponse, type NextRequest } from "next/server";

// Must match SESSION_COOKIE in lib/auth.ts. Duplicated rather than imported
// because that module is "server-only" and pulls in the Postgres driver, which
// cannot run in the middleware runtime.
const SESSION_COOKIE = "sales_ai_session";

const AUTH_PAGES = ["/login", "/signup"];

/**
 * Optimistic routing only. This checks that a session cookie is *present*, not
 * that it is valid — validating means a database round trip, which middleware
 * cannot do here. The real gate is requireOnboardedUser() in the page and
 * layout server components, and requireUserId() in the API routes.
 */
export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (AUTH_PAGES.includes(pathname)) {
    if (hasCookie) {
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }
    return NextResponse.next();
  }

  if (!hasCookie) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except the API (which answers 401 itself), Next internals, and
  // static assets. The auth pages are matched so a signed-in visitor is moved
  // on rather than shown a sign-in form.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
