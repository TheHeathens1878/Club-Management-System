import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeRelativePath } from "@/lib/auth-email-hook";
import { isBookerRole } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Where the link asked us to land afterwards. Only ever a path on this site —
  // `safeRelativePath` refuses anything else, because an open redirect on a
  // link that has just signed somebody in is how accounts get taken.
  const next = safeRelativePath(searchParams.get("next"));

  const supabase = await createClient();

  let needsPassword = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(`${origin}/login?error=auth`);
  } else if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (error) return NextResponse.redirect(`${origin}/login?error=auth`);
    needsPassword = data.user?.user_metadata?.needs_password === true;
  } else {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  if (needsPassword) {
    return NextResponse.redirect(`${origin}/auth/set-password`);
  }

  // A link that named its own destination gets it; everything else falls
  // through to the role-based default below, exactly as before.
  if (next) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Send hirers to their portal and everyone else to the club lobby (Adam,
  // 2026-08-25: confirming an email landed a new member on the room-booking
  // site). The lobby admits any signed-in person; the room diary is staff-only
  // and would bounce them straight back to /login.
  const { data: { user } } = await supabase.auth.getUser();
  let dest = "/lobby";
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (isBookerRole(profile?.role)) dest = "/portal";
  }

  return NextResponse.redirect(`${origin}${dest}`);
}
