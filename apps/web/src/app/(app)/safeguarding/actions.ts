"use server";

/**
 * Safeguarding actions (PLAN.md P4.3, P5.6 — SAFEGUARDING.md SG-3, SG-7, SG-9).
 *
 * All user-scoped. `safeguarding_concerns` has every privilege revoked from
 * `authenticated` AND from `service_role`, so there is no service-key shortcut
 * here even in principle: the SECURITY DEFINER accessors are the only door,
 * they check the caller's roles themselves, and they write the audit row
 * before they return — including when they return nothing.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Database } from "@club/db";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; notice?: string };

type ConcernStatus = Database["public"]["Enums"]["concern_status"];
type ConcernSeverity = Database["public"]["Enums"]["concern_severity"];

const SAFEGUARDING_PATH = "/safeguarding";

/** Anyone signed in may report a concern (SG-3). */
export async function reportConcern(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const narrative = String(formData.get("narrative") ?? "").trim();
  const subject = String(formData.get("subject_person_id") ?? "").trim() || undefined;
  const reported = String(formData.get("reported_person_id") ?? "").trim() || undefined;
  if (!narrative) return { error: "Describe what happened — the account is the report." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_concern", {
    p_narrative: narrative,
    p_subject_person_id: subject,
    p_reported_person_id: reported,
    p_channel: "web",
  });
  if (error) return { error: error.message };

  revalidatePath(`${SAFEGUARDING_PATH}/report`);
  return {
    notice: `Reported. Your reference is ${data}. Keep it: it is how you can ask about this report later.`,
  };
}

/** safeguarding_lead only — the accessor enforces it and audits the attempt. */
export async function updateConcern(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ref = String(formData.get("ref") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const severity = String(formData.get("severity") ?? "").trim();
  const legalHold = String(formData.get("legal_hold") ?? "").trim();
  if (!ref) return { error: "No concern given." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_concern", {
    p_ref: ref,
    p_status: status ? (status as ConcernStatus) : undefined,
    p_severity: severity ? (severity as ConcernSeverity) : undefined,
    p_legal_hold: legalHold === "" ? undefined : legalHold === "true",
  });
  if (error) return { error: error.message };

  revalidatePath(`${SAFEGUARDING_PATH}/concerns/${encodeURIComponent(ref)}`);
  revalidatePath(SAFEGUARDING_PATH);
  return { notice: "Concern updated." };
}

/** safeguarding_lead only. Notes are append-only. */
export async function addConcernNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ref = String(formData.get("ref") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!ref) return { error: "No concern given." };
  if (!body) return { error: "Write the note first." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_concern_note", { p_ref: ref, p_body: body });
  if (error) return { error: error.message };

  revalidatePath(`${SAFEGUARDING_PATH}/concerns/${encodeURIComponent(ref)}`);
  return { notice: "Note added." };
}

/**
 * SG-9 oversight. The reason is mandatory and is carried to the reading page,
 * which is what calls the accessor — so every open writes its own audit row,
 * including a refresh. That is the intended behaviour, not a bug: the audit
 * trail records reads, and a re-read is a read.
 */
export async function openConversationAsLead(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!conversationId) return { error: "Enter the conversation id." };
  if (!reason) return { error: "A reason is required. It is the difference between oversight and browsing." };

  redirect(
    `${SAFEGUARDING_PATH}/conversation?id=${encodeURIComponent(conversationId)}&reason=${encodeURIComponent(reason)}`,
  );
}
