"use server";

import { revalidatePath } from "next/cache";

import { getCapabilities } from "@/lib/capabilities";
import { collectChargeFromStoredCard, isSumUpConfigured, listCustomerInstruments } from "@/lib/sumup-finance";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { getSessionProfile } from "@/lib/auth";

export type ActionState = { error?: string; notice?: string };

/**
 * Every action here runs through the USER-SCOPED client: the DB's own
 * `is_finance()` gates and RLS policies are the inner door, and a session that
 * somehow reaches an action without the role is refused by the database, not
 * by trust in this file. The capability check is a courtesy fast-fail.
 */
async function financeSession(): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." };
  const capabilities = await getCapabilities();
  if (!capabilities.hasFinanceRole) return { error: "Finance access required." };
  return {};
}

function poundsToPence(raw: FormDataEntryValue | null): number | null {
  const value = Number(String(raw ?? "").replace(/[£,\s]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function refreshFinance() {
  revalidatePath("/finance");
  revalidatePath("/finance/members");
  revalidatePath("/finance/plans");
  revalidatePath("/finance/charges");
  revalidatePath("/finance/payments");
  revalidatePath("/my-payments");
}

// --- membership numbers ------------------------------------------------------

export async function issueNumbers(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const leadIds = formData.getAll("lead_id").map(String).filter(Boolean);
  if (leadIds.length === 0) return { error: "Tick at least one household to number." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_membership_numbers", { p_lead_person_ids: leadIds });
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: `Issued ${data?.length ?? 0} membership number${(data?.length ?? 0) === 1 ? "" : "s"}.` };
}

export async function createAccountFor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const personId = String(formData.get("person_id") ?? "");
  if (!personId) return { error: "Pick a person." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_billing_account", { p_lead_person_id: personId });
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: "Membership number issued." };
}

export async function addPersonToAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const accountId = String(formData.get("account_id") ?? "");
  const personId = String(formData.get("person_id") ?? "");
  if (!accountId || !personId) return { error: "Pick a person to add." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_person_to_billing_account", {
    p_account_id: accountId,
    p_person_id: personId,
  });
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: `Added with letter ${data}.` };
}

export async function removePersonFromAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const accountId = String(formData.get("account_id") ?? "");
  const personId = String(formData.get("person_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_person_from_billing_account", {
    p_account_id: accountId,
    p_person_id: personId,
  });
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: "Removed from the membership. Their letter stays reserved." };
}

export async function setAccountStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const accountId = String(formData.get("account_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["active", "lapsed", "closed"].includes(status)) return { error: "Invalid status." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("billing_accounts")
    .update({ status: status as "active" | "lapsed" | "closed" })
    .eq("id", accountId);
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: `Membership marked ${status}.` };
}

// --- plans -------------------------------------------------------------------

export async function saveFeePlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const id = String(formData.get("plan_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const amountPence = poundsToPence(formData.get("amount"));
  const kind = String(formData.get("kind") ?? "other");
  const scopeRaw = String(formData.get("scope") ?? "");
  const schedule = String(formData.get("schedule") ?? "one_off");
  const cohort = String(formData.get("cohort") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const monthsRaw = String(formData.get("months_total") ?? "").trim();
  const monthsTotal = monthsRaw ? Number(monthsRaw) : null;

  if (!name) return { error: "The plan needs a name." };
  if (!amountPence) return { error: "Enter an amount in pounds, greater than zero." };
  if (!["membership", "subs", "fine", "other"].includes(kind)) return { error: "Invalid kind." };
  if (!["one_off", "monthly", "annual"].includes(schedule)) return { error: "Invalid schedule." };
  if (monthsTotal !== null && (!Number.isInteger(monthsTotal) || monthsTotal < 1 || monthsTotal > 24))
    return { error: "Months must be between 1 and 24." };
  if (monthsTotal !== null && schedule !== "monthly")
    return { error: "A month count only applies to monthly plans." };

  const row = {
    name,
    description,
    cohort,
    kind: kind as "membership" | "subs" | "fine" | "other",
    scope: scopeRaw === "individual" || scopeRaw === "family" ? (scopeRaw as "individual" | "family") : null,
    amount_pence: amountPence,
    schedule: schedule as "one_off" | "monthly" | "annual",
    months_total: monthsTotal,
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("fee_plans").update(row).eq("id", id)
    : await supabase.from("fee_plans").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/finance/plans");
  return { notice: id ? "Plan updated." : "Plan created." };
}

export async function deleteFeePlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const id = String(formData.get("plan_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("fee_plans").delete().eq("id", id);
  if (error) {
    if (error.code === "23503")
      return { error: "This plan is in use — agreements or charges reference it. Deactivate it instead." };
    return { error: error.message };
  }
  revalidatePath("/finance/plans");
  return { notice: "Plan deleted." };
}

// Super user only — the DB's charges_delete_guard() is the real door: unpaid
// only, audited before the row goes. RLS filters silently for anyone else, so
// the zero-rows case gets its own message.
export async function deleteCharge(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const chargeId = String(formData.get("charge_id") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.from("charges").delete().eq("id", chargeId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a super user can delete a charge." };
  refreshFinance();
  return { notice: "Charge deleted. The deletion is on the audit log." };
}

export async function setFeePlanActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const id = String(formData.get("plan_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("fee_plans").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/plans");
  return { notice: active ? "Plan activated." : "Plan deactivated." };
}

// The six boxes: reprice the system plans and activate them. Saving is what
// switches enrolment on — subs_quote() refuses while a needed plan is inactive.
export async function saveFees(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const keys = [
    "membership_individual", "membership_family",
    "subs_monthly_individual", "subs_monthly_family",
    "fine_yellow", "fine_red",
  ];
  const supabase = await createClient();
  for (const key of keys) {
    const raw = formData.get(key);
    if (raw == null || String(raw).trim() === "") continue;
    const amountPence = poundsToPence(raw);
    if (!amountPence) return { error: `"${key.replace(/_/g, " ")}" needs an amount in pounds, greater than zero.` };
    const { error } = await supabase
      .from("fee_plans")
      .update({ amount_pence: amountPence, active: true })
      .eq("system_key", key);
    if (error) return { error: error.message };
  }
  revalidatePath("/finance/fees");
  revalidatePath("/finance/plans");
  revalidatePath("/my-payments");
  return { notice: "Fees saved and active. Households can now enrol." };
}

// The treasurer's enrolment door — same DB function the member's button calls.
export async function enrollHouseholdAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const accountId = String(formData.get("account_id") ?? "");
  const mode = String(formData.get("mode") ?? "");
  if (!accountId) return { error: "Pick a membership." };
  if (!["upfront", "monthly"].includes(mode)) return { error: "Pick up-front or monthly." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("enroll_household", { p_account_id: accountId, p_mode: mode });
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: mode === "upfront" ? "Enrolled — the season total is now owed." : "Enrolled — membership owed now, subs on the 1st of each month to 1 May." };
}

// --- charges -----------------------------------------------------------------

export async function raiseChargeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const personId = String(formData.get("person_id") ?? "");
  const planId = String(formData.get("plan_id") ?? "") || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const dueOn = String(formData.get("due_on") ?? "") || null;
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amountPence = amountRaw ? poundsToPence(formData.get("amount")) : null;
  if (!personId) return { error: "Pick who the charge is for." };
  if (amountRaw && !amountPence) return { error: "Enter an amount in pounds, greater than zero." };
  if (!planId && (!description || !amountPence))
    return { error: "A bespoke charge needs a description and an amount." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("raise_charge", {
    p_person_id: personId,
    p_plan_id: planId ?? undefined,
    p_description: description ?? undefined,
    p_amount_pence: amountPence ?? undefined,
    p_due_on: dueOn ?? undefined,
  });
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: "Charge raised against the lead member's account." };
}

export async function waiveCharge(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const chargeId = String(formData.get("charge_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "A waiver needs a written reason." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("charges")
    .update({ status: "waived", waived_reason: reason })
    .eq("id", chargeId);
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: "Charge waived." };
}

export async function voidCharge(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const chargeId = String(formData.get("charge_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("charges").update({ status: "void" }).eq("id", chargeId);
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: "Charge voided." };
}

export async function startAgreementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const accountId = String(formData.get("account_id") ?? "");
  const planId = String(formData.get("plan_id") ?? "");
  const autoCollect = formData.get("auto_collect") === "on";
  if (!accountId || !planId) return { error: "Pick a membership and a plan." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_agreement", {
    p_account_id: accountId,
    p_plan_id: planId,
    p_auto_collect: autoCollect,
  });
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: "Agreement started." };
}

export async function cancelAgreement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const agreementId = String(formData.get("agreement_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const supabase = await createClient();
  const { error } = await supabase
    .from("billing_agreements")
    .update({ status: "cancelled", cancel_reason: reason, cancelled_at: new Date().toISOString(), next_charge_on: null })
    .eq("id", agreementId);
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: "Agreement cancelled. Charges already raised stay on the book." };
}

// Collect a pending charge from the account's stored card (the pre-authorised
// path for fines, and a treasurer's manual "collect now").
export async function collectFromStoredCard(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  if (!isSumUpConfigured()) return { error: "SumUp is not configured." };
  const chargeId = String(formData.get("charge_id") ?? "");
  const supabase = await createClient();
  const { data: charge } = await supabase
    .from("charges")
    .select("id,charge_no,account_id,description,amount_pence,status")
    .eq("id", chargeId)
    .maybeSingle();
  if (!charge) return { error: "Charge not found." };
  if (charge.status !== "pending") return { error: "Only an outstanding charge can be collected." };
  const { data: mandate } = await supabase
    .from("payment_mandates")
    .select("id,sumup_customer_id,status")
    .eq("account_id", charge.account_id)
    .eq("status", "active")
    .maybeSingle();
  if (!mandate) return { error: "No active card on file for this membership." };

  const instruments = await listCustomerInstruments(mandate.sumup_customer_id);
  const instrument = instruments.find((i) => i.active);
  if (!instrument) return { error: "The stored card is no longer usable — ask the member to save a new one." };

  // The same door the nightly run uses: the attempt is claimed before SumUp
  // is asked, an earlier unfinished attempt is reconciled first, and the
  // amount is what is still outstanding — so "collect now" twice, or once
  // during the cron, cannot take the money twice.
  let collectedPence = 0;
  try {
    const result = await collectChargeFromStoredCard({
      chargeId: charge.id,
      description: charge.description,
      customerId: mandate.sumup_customer_id,
      token: instrument.token,
    });
    switch (result.outcome) {
      case "collected":
        collectedPence = result.amountPence;
        break;
      case "recovered":
        refreshFinance();
        return { notice: "An earlier collection had already gone through — it is now recorded." };
      case "settled":
        refreshFinance();
        return { notice: "Nothing outstanding on this charge." };
      case "below_minimum":
        return { error: "The outstanding balance is under £1.00, which is less than a card payment can be. Record it another way." };
      case "in_flight":
        return { error: "A collection for this charge started moments ago and has not finished. Give it a few minutes." };
      case "failed":
        return { error: `Collection did not complete: ${result.reason}` };
    }
  } catch (e) {
    console.error("[finance] stored-card collection failed:", e);
    return { error: "SumUp refused the collection. The card may be expired." };
  }
  const session = await getSessionProfile();
  await writeAudit({
    actorId: session?.userId ?? null,
    actorEmail: session?.email ?? null,
    action: "finance.mandate_collection",
    entity: "charges",
    entityId: chargeId,
    detail: { amount_pence: collectedPence },
  });
  refreshFinance();
  return { notice: "Collected from the stored card." };
}

// --- payments ----------------------------------------------------------------

export async function recordChargePayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const chargeId = String(formData.get("charge_id") ?? "");
  const amountPence = poundsToPence(formData.get("amount"));
  const method = String(formData.get("method") ?? "cash");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  if (!chargeId) return { error: "Pick a charge." };
  if (!amountPence) return { error: "Enter an amount in pounds, greater than zero." };
  if (!["cash", "card", "bank_transfer", "other"].includes(method)) return { error: "Invalid method." };
  const supabase = await createClient();
  const { error } = await supabase.from("payments").insert({
    charge_id: chargeId,
    amount_pence: amountPence,
    paid_at: new Date().toISOString(),
    method,
    source: "manual",
    reference,
  });
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: "Payment recorded." };
}

export async function refundPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const paymentId = String(formData.get("payment_id") ?? "");
  const amountPence = poundsToPence(formData.get("amount"));
  if (!amountPence) return { error: "Enter the refunded amount in pounds." };
  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id,amount_pence,refunded_pence,charge_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment || !payment.charge_id) return { error: "Payment not found." };
  if (amountPence + payment.refunded_pence > payment.amount_pence)
    return { error: "Refund exceeds what was paid." };
  const { error } = await supabase
    .from("payments")
    .update({ refunded_pence: payment.refunded_pence + amountPence, refunded_at: new Date().toISOString() })
    .eq("id", paymentId);
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: "Refund recorded. Money moves back through SumUp separately if it was a card payment." };
}

// --- mandates & settings -----------------------------------------------------

export async function revokeMandate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const mandateId = String(formData.get("mandate_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase
    .from("payment_mandates")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", mandateId);
  if (error) return { error: error.message };
  refreshFinance();
  return { notice: "Card on file revoked. Nothing further will be collected from it." };
}

export async function saveFinanceSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await financeSession();
  if (gate.error) return gate;
  const keys = [
    "finance.xero_account_membership",
    "finance.xero_account_subs",
    "finance.xero_account_fine",
    "finance.xero_account_hire",
    "finance.xero_account_other",
    "finance.xero_tax_type",
  ] as const;
  const supabase = await createClient();
  for (const key of keys) {
    const value = String(formData.get(key) ?? "").trim();
    if (!value) continue;
    const { error } = await supabase.from("site_settings").upsert({ key, value }, { onConflict: "key" });
    if (error) return { error: error.message };
  }
  revalidatePath("/finance/settings");
  return { notice: "Finance settings saved." };
}
