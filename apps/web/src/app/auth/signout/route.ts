import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `${proto}://${host}`;

  return NextResponse.redirect(`${origin}/login`, { status: 303 });
}
