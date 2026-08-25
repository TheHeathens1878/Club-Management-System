import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { isBookerRole, type Profile, type UserRole } from "@/lib/types";

/**
 * Who is signed in, and what their profile row says.
 *
 * `cache()` is not an optimisation detail here, it is what makes the app
 * responsive. `auth.getUser()` is a NETWORK call to the Supabase auth server,
 * and this function is asked the same question many times while one page
 * renders — the layout, `getCapabilities()`, and the page itself all need it.
 * React's per-request cache collapses those into one call and one profile
 * read; the answer cannot change mid-render, so nothing is stale.
 */
export const getSessionProfile = cache(async function getSessionProfile(): Promise<{
  userId: string;
  email: string | null;
  profile: Profile | null;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  return { userId: user.id, email: user.email ?? null, profile: profile ?? null };
});

export function isSuperUser(role: UserRole | undefined | null): boolean {
  return role === "super_user";
}

export function isCommittee(role: UserRole | undefined | null): boolean {
  // committee or super_user — both have full admin access
  return role === "committee" || role === "super_user";
}

export function isBarManager(role: UserRole | undefined | null): boolean {
  return role === "bar_manager" || role === "committee" || role === "super_user";
}

export function isStaff(role: UserRole | undefined | null): boolean {
  return role === "super_user" || role === "committee" || role === "bar_manager" || role === "bar";
}

export function isBooker(role: UserRole | undefined | null): boolean {
  return isBookerRole(role);
}

export function canEditMembers(role: UserRole | undefined | null): boolean {
  return role === "super_user" || role === "committee" || role === "bar";
}

export function canCreateMemberDirectly(role: UserRole | undefined | null): boolean {
  return role === "super_user";
}

export function canApproveApplications(role: UserRole | undefined | null): boolean {
  return role === "super_user" || role === "committee";
}
