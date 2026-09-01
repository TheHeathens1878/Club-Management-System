import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Back to the login page of the domain they were ACTUALLY using. The club
  // has four (portal, coaches, membership, roombooking) all serving this app,
  // and this route used to prefer `NEXT_PUBLIC_SITE_URL` over the request —
  // so signing out at portal.aomsportsclub.co.uk landed you on
  // roombooking.aomsportsclub.co.uk, the old room-booking address, because
  // that is what the variable is set to in Vercel (Adam, 2026-09-01).
  //
  // A canonical site URL is for links built where there is no request to read
  // — a magic link, a payment return, an email. This is a redirect for a
  // request that is in front of us, so it follows the request. The variable
  // stays as the fallback for the impossible case of no forwarded host.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL ?? "");

  return NextResponse.redirect(`${origin}/login`, { status: 303 });
}
