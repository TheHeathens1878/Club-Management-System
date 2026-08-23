"use server";

/**
 * First-login DOB gate for accounts imported from the pitch-booking app
 * (PLAN.md P3.2/P3.3, MIGRATION_MAP.md D-P3-6 option 1a).
 *
 * Everything the safeguarding model does hinges on whether a person is a
 * minor, and SG-0 treats an unknown DOB as "minor". The import could not
 * invent dates of birth, so the database holds each imported adult's team
 * memberships back until the person supplies it — once, here, through
 * `complete_own_dob()`, which is the only self-service write to
 * `people.dob` that exists.
 */

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string };

export async function completeDob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const dob = String(formData.get("dob") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return { error: "Enter your date of birth." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_own_dob", { p_dob: dob });
  if (error) return { error: error.message };

  redirect("/");
}
