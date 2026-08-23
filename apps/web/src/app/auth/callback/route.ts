import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { isBookerRole } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

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

  // Send bookers to their portal; staff/members to the bookings area.
  const { data: { user } } = await supabase.auth.getUser();
  let dest = "/room-bookings";
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
