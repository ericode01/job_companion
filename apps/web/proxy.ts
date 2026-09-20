import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/setup", "/invite"];

/** The pipeline used to live under each search; older links (digest emails) land on it filtered. */
const OLD_PIPELINE = /^\/d\/(\d+)\/pipeline\/?$/;

/**
 * Optimistic check only: no session cookie → sign-in page. The real check (a valid, unexpired
 * session) happens in every page and API route, since proxy shouldn't touch the database.
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const moved = OLD_PIPELINE.exec(pathname);
  if (moved) {
    const url = req.nextUrl.clone();
    const app = req.nextUrl.searchParams.get("app");
    url.pathname = "/pipeline";
    url.search = `?search=${moved[1]}${app ? `&app=${encodeURIComponent(app)}` : ""}`;
    return NextResponse.redirect(url);
  }
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.has("jd_session")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Pages only: API routes answer 401 themselves; static assets need no session.
  matcher: ["/((?!api|_next|favicon.ico|icon.svg).*)"],
};
