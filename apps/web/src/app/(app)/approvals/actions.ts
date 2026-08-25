"use server";

/**
 * The approvals desk's two writes (gap 4).
 *
 * Neither of them touches `account_requests` directly: there is no admin
 * UPDATE policy on that table on purpose, so a decision can only be made
 * through `approve_account_request()` / `reject_account_request()`, which
 * check `is_club_admin()`, carry out the side effect (team membership, or the
 * `parent` role) and write the audit row as one unit.
 *
 * `approve` has three outcomes and all three matter:
 *   · `approved`       — done.
 *   · `already_decided` — someone else got there first; `detail` is the status.
 *   · `blocked`        — the SG-6 guard refused, most often a missing or
 *                        expired DBS / safeguarding certificate. The request
 *                        stays pending, the reason is recorded on it, and it
 *                        is shown here verbatim with a way to go and fix it.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const PATH = "/approvals";

export type DecisionState = {
  error?: string;
  notice?: string;
  /** SG-6 (or another guard) refused; `detail` is the database's own words. */
  blocked?: { detail: string; personId: string };
};

export async function approveRequest(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const requestId = String(formData.get("request_id") ?? "").trim();
  const personId = String(formData.get("person_id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!requestId) return { error: "Missing request." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_account_request", {
    p_request_id: requestId,
    p_note: note || undefined,
  });

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Only a club administrator can approve a request."
          : error.message,
    };
  }

  const result = (data ?? [])[0];
  revalidatePath(PATH);

  if (!result) return { error: "The database returned no outcome. Refresh and check the request." };
  if (result.outcome === "approved") return { notice: "Approved." };
  if (result.outcome === "already_decided") {
    return { notice: `Nothing to do — this request is already ${result.detail}.` };
  }
  return { blocked: { detail: result.detail ?? "The request was refused.", personId } };
}

/**
 * "This player has left", decided (Adam, 2026-08-25).
 *
 * Same shape as the two above and for the same reason: there is no UPDATE
 * policy on `team_membership_leave_requests` at all, so the only way a status
 * moves is `decide_leave_request()`, which checks `is_club_admin()`, ends the
 * membership through the ordinary admin UPDATE (so the SG-6 trigger still
 * runs), audits it and tells the coach who asked — as one unit.
 *
 * `blocked` is SG-6 refusing to let the membership end. The request stays
 * pending with the guard's own sentence recorded on it.
 */
export async function decideLeaveRequest(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const requestId = String(formData.get("request_id") ?? "").trim();
  const personId = String(formData.get("person_id") ?? "").trim();
  const approve = String(formData.get("approve") ?? "") === "yes";
  const note = String(formData.get("note") ?? "").trim();
  if (!requestId) return { error: "Missing request." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_leave_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_note: note || undefined,
  });

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Only a club administrator can decide a squad change."
          : error.message,
    };
  }

  const result = (data ?? [])[0];
  revalidatePath(PATH);

  if (!result) return { error: "The database returned no outcome. Refresh and check the request." };
  if (result.outcome === "approved") return { notice: "Approved — the membership has ended." };
  if (result.outcome === "rejected") return { notice: "Rejected — the player stays in the squad." };
  if (result.outcome === "already_decided") {
    return { notice: `Nothing to do — this request is already ${result.detail}.` };
  }
  return { blocked: { detail: result.detail ?? "The request was refused.", personId } };
}

export async function rejectRequest(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const requestId = String(formData.get("request_id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!requestId) return { error: "Missing request." };
  if (!note) return { error: "Say why — the person sees this." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_account_request", {
    p_request_id: requestId,
    p_note: note,
  });

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Only a club administrator can reject a request."
          : error.message,
    };
  }

  revalidatePath(PATH);
  return { notice: "Rejected." };
}
