import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "@club/db";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/" ||
    path === "/manifest.json" ||
    path === "/sw.js" ||
    path.startsWith("/login") ||
    // Gap 4: public self-registration, allow-listed the same way as the
    // waiting list form. Everything it does runs on the anon client, and
    // SG-10 decides in the database whether the account may exist at all.
    path.startsWith("/register") ||
    path.startsWith("/privacy") ||
    path.startsWith("/auth") ||
    path.startsWith("/_next") ||
    path.startsWith("/favicon") ||
    path.startsWith("/icon-") ||
    path.startsWith("/apply") ||
    path.startsWith("/endorse") ||
    path.startsWith("/book") ||
    // P3.4: the player waiting list form is public, but only at its own path —
    // /waiting-list/manage is the staff desk and stays behind the sign-in. The
    // /recruitment redirect is served from next.config before middleware runs;
    // it is listed here so a direct hit can never bounce to /login instead.
    path === "/waiting-list" ||
    path.startsWith("/recruitment") ||
    // Server-to-server callbacks with no session — they guard themselves:
    // the SumUp webhook + payment-return are idempotent and keyed by checkout
    // id; the cron route checks CRON_SECRET.
    path.startsWith("/api/sumup") ||
    path.startsWith("/api/cron") ||
    path.startsWith("/portal/pay/return");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", path);
    return NextResponse.redirect(url);
  }

  // P3.3 first-login gate: an account imported from the pitch-booking app
  // must record its date of birth before anything else (SG-0 treats an
  // unknown DOB as a minor, so the person's teams stay hidden until then).
  // One cheap SECURITY DEFINER call per page request; API, auth and asset
  // paths are left alone so the page itself can load and sign out works.
  if (
    user &&
    !isPublic &&
    !path.startsWith("/complete-profile") &&
    !path.startsWith("/api") &&
    !path.startsWith("/auth")
  ) {
    const { data: needsDob } = await supabase.rpc("needs_dob_completion");
    if (needsDob === true) {
      const url = request.nextUrl.clone();
      url.pathname = "/complete-profile";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // Gap 4 first-login nudge: someone who has never said which hat they wear is
  // sent to /welcome once. It runs AFTER the DOB gate above on purpose — an
  // imported account finishes that first — and only on a GET, so a server
  // action POST is never turned into a redirect. `club.role_view_prompted` is
  // set here so it happens exactly once whether or not they pick a tile;
  // `club.role_view` is written only when they actually choose one.
  if (
    user &&
    !isPublic &&
    request.method === "GET" &&
    !path.startsWith("/welcome") &&
    !path.startsWith("/complete-profile") &&
    !path.startsWith("/portal") &&
    !path.startsWith("/api") &&
    !path.startsWith("/auth") &&
    !request.cookies.has("club.role_view") &&
    !request.cookies.has("club.role_view_prompted")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    const redirectResponse = NextResponse.redirect(url);
    // Carry over anything the session refresh above wrote.
    for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
    redirectResponse.cookies.set("club.role_view_prompted", "1", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
