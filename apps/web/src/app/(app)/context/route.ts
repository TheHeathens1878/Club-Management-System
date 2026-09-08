import { NextResponse } from "next/server";

import { safeRelativePath } from "@/lib/auth-email-hook";
import { applyRoleView } from "@/app/(app)/welcome/actions";
import { isRoleView } from "@/lib/role-view";

/**
 * Context follows the link (P7.2). A Club row such as "Coaching · U14
 * Mavericks" is `/context?view=coach&team=<id>&next=/teams/<id>`: this
 * handler puts the hat on — the same validated cookie write the switcher
 * does, so an unqualified view or a team the hat does not hold is simply not
 * written — and continues to the page. The person never chooses a mode; they
 * open the thing, and the thing says which hat it is wearing.
 *
 * Nothing is granted here. The cookies decide what a page OFFERS; the
 * database decides what it HANDS OVER, and it answers to the person.
 *
 * `next` must be a path on this site — `safeRelativePath` refuses anything
 * else, because a redirector that forwards to arbitrary URLs is an open
 * redirect wearing a club crest.
 *
 * THE REDIRECT STAYS ON THE HOST THAT WAS ASKED (Adam, 2026-09-08: "Club
 * administration › Teams should allow me to see all teams and not just my
 * own"). This handler used to send the browser to NEXT_PUBLIC_SITE_URL,
 * which on production is the Vercel project address while the club opens
 * the app on its own domain — so the hat was written as a cookie on one
 * host and the page opened on the other, without it, still in the coach
 * view. The path is already vetted; the origin is simply the request's.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  const team = url.searchParams.get("team");
  const next = safeRelativePath(url.searchParams.get("next")) ?? "/lobby";

  if (isRoleView(view)) {
    await applyRoleView(view, team ?? undefined);
  }
  return NextResponse.redirect(new URL(next, url.origin), { status: 303 });
}
