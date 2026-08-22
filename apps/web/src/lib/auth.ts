import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types";

export async function getSessionProfile(): Promise<{
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
}

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
  return role === "booker";
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
