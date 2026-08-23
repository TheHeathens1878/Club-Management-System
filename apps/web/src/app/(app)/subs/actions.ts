"use server";

/**
 * Subscriptions administration (PLAN.md P4.1, P4.2).
 *
 * User-scoped client. `subscription_plans` is club_admin-only by policy,
 * `subscriptions` status changes are club_admin-or-Stripe by a trigger, and
 * `payments` inserts are staff-or-admin. Every one of those is a rule the
 * database already holds; the app's committee gate is the outer of the two
 * doors, not a replacement for the inner one.
 */

import { revalidatePath } from "next/cache";

import type { Database } from "@club/db";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; notice?: string };

type Billing = Database["public"]["Enums"]["billing_kind"];

const SUBS_PATH = "/subs";

/** Pounds in the form, pence in the database. */
function poundsToPence(value: string): number | null {
  const amount = Number(value.replace(/[£,\s]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

export async function createPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const seasonId = String(formData.get("season_id") ?? "");
  const teamId = String(formData.get("team_id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const billing = String(formData.get("billing") ?? "one_off") as Billing;
  const instalmentsRaw = String(formData.get("instalments") ?? "").trim();
  const amountPence = poundsToPence(String(formData.get("amount") ?? ""));

  if (!seasonId) return { error: "Pick a season." };
  if (!name) return { error: "The plan needs a name." };
  if (!amountPence) return { error: "Enter an amount greater than zero." };
  if (billing === "monthly" && !instalmentsRaw) {
    return { error: "A monthly plan needs a number of instalments." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("subscription_plans").insert({
    season_id: seasonId,
    team_id: teamId,
    name,
    description,
    amount_pence: amountPence,
    billing,
    instalments: instalmentsRaw ? Number(instalmentsRaw) : null,
  });
  if (error) return { error: error.message };

  revalidatePath(SUBS_PATH);
  return { notice: "Plan created." };
}

export async function setPlanActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("plan_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return { error: "No plan given." };

  const supabase = await createClient();
  const { error } = await supabase.from("subscription_plans").update({ active }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(SUBS_PATH);
  return { notice: active ? "Plan reopened." : "Plan closed to new subscriptions." };
}

/**
 * A payment taken outside Stripe — cash at the bar, a bank transfer. It lands
 * in the same ledger, so the arrears view nets it off like any other.
 */
export async function recordPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subscriptionId = String(formData.get("subscription_id") ?? "");
  const amountPence = poundsToPence(String(formData.get("amount") ?? ""));
  const method = String(formData.get("method") ?? "").trim() || "manual";
  const reference = String(formData.get("reference") ?? "").trim() || null;

  if (!subscriptionId) return { error: "No subscription given." };
  if (!amountPence) return { error: "Enter an amount greater than zero." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("payments").insert({
    subscription_id: subscriptionId,
    booking_id: null,
    amount_pence: amountPence,
    method,
    reference,
    source: "manual",
    authorised_by_profile: user.user?.id ?? null,
    authorised_by_email: user.user?.email ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath(SUBS_PATH);
  return { notice: "Payment recorded." };
}

export async function cancelSubscription(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("subscription_id") ?? "");
  const reason = String(formData.get("cancel_reason") ?? "").trim() || null;
  if (!id) return { error: "No subscription given." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(SUBS_PATH);
  revalidatePath("/my-subs");
  return { notice: "Subscription cancelled." };
}
