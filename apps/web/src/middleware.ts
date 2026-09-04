import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "@club/db";
import { NextResponse, type NextRequest } from "next/server";

import { ROLE_VIEW_COOKIE, ROLE_VIEW_HOME, isRoleView } from "@/lib/role-view";
import { isBookerRole } from "@/lib/types";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** "This signed-in user has a recorded DOB" — see the gate below for why. */
const DOB_OK_COOKIE = "club.dob_ok";

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
    // Linked from the public front door and the login page — a contact page
    // that bounces to /login is a door painted on a wall (2026-09-04 audit).
    path.startsWith("/contact") ||
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
    // The join-the-club wizard: public for its first step (account creation);
    // every later step runs signed-in through its server actions.
    path.startsWith("/join") ||
    path.startsWith("/recruitment") ||
    // Server-to-server callbacks with no session — they guard themselves:
    // the SumUp webhook + payment-return are idempotent and keyed by checkout
    // id; the cron route checks CRON_SECRET.
    path.startsWith("/api/sumup") ||
    path.startsWith("/api/cron") ||
    // Supabase Auth's Send Email hook posts here with no session at all; it
    // guards itself with the Standard Webhooks signature on every request.
    path.startsWith("/api/auth") ||
    path.startsWith("/portal/pay/return");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", path);
    return NextResponse.redirect(url);
  }

  // The root path is the club's public function-room page. Somebody who is
  // signed in as a member of the club has no business landing there: send them
  // to the home screen of the view they last chose, or — if they have not
  // chosen — to the lobby, the Me view's main page. Bookers are left alone:
  // the public page IS their page.
  if (user && path === "/" && request.method === "GET") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!isBookerRole(profile?.role)) {
      const stored = request.cookies.get(ROLE_VIEW_COOKIE)?.value;
      const url = request.nextUrl.clone();
      url.search = "";
      // Adam, 2026-08-25: a first sign-in defaults to the Club Lobby — the
      // one place everyone can see — rather than being made to pick a hat.
      // The switcher in the sidebar is where the hats live now.
      url.pathname = isRoleView(stored) ? ROLE_VIEW_HOME[stored] : "/lobby";
      const redirectResponse = NextResponse.redirect(url);
      for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
      return redirectResponse;
    }
  }

  // P3.3 first-login gate: an account imported from the pitch-booking app
  // must record its date of birth before anything else (SG-0 treats an
  // unknown DOB as a minor, so the person's teams stay hidden until then).
  // API, auth and asset paths are left alone so the page itself can load and
  // sign out works.
  //
  // The answer only ever moves one way — a recorded date of birth is never
  // un-recorded by the person themself — so a "no, nothing needed" is
  // remembered in a cookie keyed to the user id, and the RPC is asked once
  // per browser rather than once per page. The cookie is a routing hint and
  // nothing more: someone who forges it skips a nudge page, while SG-0 in the
  // database keeps their teams hidden exactly as before.
  if (
    user &&
    !isPublic &&
    !path.startsWith("/complete-profile") &&
    !path.startsWith("/api") &&
    !path.startsWith("/auth")
  ) {
    const dobOk = request.cookies.get(DOB_OK_COOKIE)?.value === user.id;
    if (!dobOk) {
      const { data: needsDob } = await supabase.rpc("needs_dob_completion");
      if (needsDob === true) {
        const url = request.nextUrl.clone();
        url.pathname = "/complete-profile";
        url.search = "";
        return NextResponse.redirect(url);
      }
      response.cookies.set(DOB_OK_COOKIE, user.id, {
        maxAge: 60 * 60 * 24 * 30,
        sameSite: "lax",
        httpOnly: true,
        path: "/",
      });
    }
  }

  // There is no first-login nudge to /welcome any more (owner ruling 1, made
  // real with the Me view): with no cookie the layout resolves the Me view for
  // anyone the club knows, and a `/` hit above already lands on the lobby —
  // the one place everyone can see. The tiles at /welcome stay for deliberate
  // visits via "My role".

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
