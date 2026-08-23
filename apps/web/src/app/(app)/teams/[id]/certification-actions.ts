"use server";

/**
 * Certifications and SG-6 exemptions for one team (PLAN.md P4.3).
 *
 * User-scoped client on purpose. `certifications` is written by club_admin or
 * safeguarding_lead per its RLS, `certification_exemptions` by the lead alone
 * — and a trigger insists the grant is attributed to the caller and caps it at
 * 30 days. Going through the service key would take all of that off the table
 * and leave the app's own role check as the only control, which is precisely
 * the arrangement SAFEGUARDING.md §1.2 rules out.
 */

import { revalidatePath } from "next/cache";

import type { Database } from "@club/db";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; notice?: string };

type CertificationType = Database["public"]["Enums"]["certification_type"];

const TYPES: CertificationType[] = ["fa_dbs", "safeguarding_children", "first_aid", "coaching_badge"];

function teamPath(teamId: string): string {
  return `/teams/${teamId}`;
}

export async function addCertification(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const teamId = String(formData.get("team_id") ?? "");
  const personId = String(formData.get("person_id") ?? "");
  const type = String(formData.get("type") ?? "");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const issuedOn = String(formData.get("issued_on") ?? "").trim() || null;
  const expiresOn = String(formData.get("expires_on") ?? "").trim() || null;

  if (!personId) return { error: "Pick a person." };
  if (!TYPES.includes(type as CertificationType)) return { error: "Pick a certification type." };

  const supabase = await createClient();
  const { error } = await supabase.from("certifications").insert({
    person_id: personId,
    type: type as CertificationType,
    reference,
    issued_on: issuedOn,
    expires_on: expiresOn,
  });
  if (error) return { error: error.message };

  revalidatePath(teamPath(teamId));
  return { notice: "Certification recorded. It counts once it is verified." };
}

export async function verifyCertification(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const teamId = String(formData.get("team_id") ?? "");
  const id = String(formData.get("certification_id") ?? "");
  if (!id) return { error: "No certification given." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("certifications")
    .update({ verified_at: new Date().toISOString(), verified_by: user.user?.id ?? null })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(teamPath(teamId));
  return { notice: "Verified." };
}

export async function revokeCertification(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const teamId = String(formData.get("team_id") ?? "");
  const id = String(formData.get("certification_id") ?? "");
  if (!id) return { error: "No certification given." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("certifications")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.user?.id ?? null })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(teamPath(teamId));
  return { notice: "Revoked." };
}

/** SG-6 escape hatch: lead only, reason mandatory, 30 days maximum (a CHECK). */
export async function grantExemption(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const teamId = String(formData.get("team_id") ?? "");
  const personId = String(formData.get("person_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const expiresOn = String(formData.get("expires_on") ?? "").trim();

  if (!personId) return { error: "Pick a person." };
  if (!reason) return { error: "An exemption needs a reason. It is never silent." };
  if (!expiresOn) return { error: "An exemption needs an end date, at most 30 days away." };

  const supabase = await createClient();
  const { data: grantedBy } = await supabase.rpc("current_person_id");
  if (!grantedBy) return { error: "Your account is not linked to a member record yet." };

  const { error } = await supabase.from("certification_exemptions").insert({
    person_id: personId,
    team_id: teamId,
    reason,
    expires_on: expiresOn,
    granted_by_person_id: grantedBy,
  });
  if (error) return { error: error.message };

  revalidatePath(teamPath(teamId));
  return { notice: "Exemption granted and logged." };
}

export async function revokeExemption(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const teamId = String(formData.get("team_id") ?? "");
  const id = String(formData.get("exemption_id") ?? "");
  if (!id) return { error: "No exemption given." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("certification_exemptions")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.user?.id ?? null })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(teamPath(teamId));
  return { notice: "Exemption revoked." };
}
