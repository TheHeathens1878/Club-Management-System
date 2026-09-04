"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth";
import { getSiteUrl } from "@/lib/utils";
import {
  createChargeCheckout,
  ensureSumUpCustomer,
  recordSumUpChargePaymentIfPaid,
} from "@/lib/sumup-finance";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Member-side payment actions. Ownership is proved by RLS, not by trust: the
 * charge is read back through the USER-SCOPED client, and `charges_read` only
 * answers for the caller's own household (or finance). If the row comes back,
 * the caller may pay it.
 */

export async function createCheckoutForCharge(
  chargeId: string,
  saveCard: boolean,
  coverFines: boolean,
): Promise<{ checkoutId?: string; error?: string }> {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: charge } = await supabase
    .from("charges")
    .select("id,description,amount_pence,status,account_id,charge_no,payments(amount_pence,refunded_pence)")
    .eq("id", chargeId)
    .maybeSingle();
  if (!charge) return { error: "Charge not found." };
  if (charge.status !== "pending") return { error: "This charge is not outstanding." };
  const paid = (charge.payments ?? []).reduce((acc, p) => acc + p.amount_pence - p.refunded_pence, 0);
  const outstanding = charge.amount_pence - paid;
  if (outstanding < 100) return { error: "Card payments must be at least £1.00. Contact the club to settle a smaller amount." };

  try {
    let save: { customerId: string } | undefined;
    if (saveCard) {
      const customerId = await ensureSumUpCustomer(charge.account_id);
      save = { customerId };
      // A pending mandate row now; activated when the checkout succeeds.
      const admin = createAdminClient();
      const { data: existing } = await admin
        .from("payment_mandates")
        .select("id,status")
        .eq("account_id", charge.account_id)
        .in("status", ["pending", "active"])
        .maybeSingle();
      if (!existing) {
        await admin.from("payment_mandates").insert({
          account_id: charge.account_id,
          sumup_customer_id: customerId,
          status: "pending",
          covers_fines: coverFines,
          consented_by: session.userId,
        });
      } else if (existing.status === "pending") {
        await admin
          .from("payment_mandates")
          .update({ covers_fines: coverFines, consented_by: session.userId })
          .eq("id", existing.id);
      }
    }
    const checkout = await createChargeCheckout({
      chargeId: charge.id,
      amountPence: outstanding,
      description: `CHG-${charge.charge_no} — ${charge.description}`,
      returnUrl: `${getSiteUrl()}/my-payments`,
      saveCard: save,
    });
    return { checkoutId: checkout.id };
  } catch (e) {
    console.error("[my-payments] SumUp checkout creation failed:", e);
    return { error: "Could not start the payment. Please try again." };
  }
}

export async function finalizeChargeCheckout(checkoutId: string): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." };
  try {
    await recordSumUpChargePaymentIfPaid(checkoutId);
  } catch (e) {
    console.error("[my-payments] SumUp finalize failed:", e);
    return { error: "Payment verification failed. If you were charged, please contact the club." };
  }
  revalidatePath("/my-payments");
  return {};
}

// The lead member can withdraw the card (and with it the fines
// pre-authorisation) at any time.
export async function revokeMyMandate(): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("billing_accounts")
    .select("id, payment_mandates(id,status)")
    .limit(1)
    .maybeSingle();
  const mandate = account?.payment_mandates?.find((m) => m.status === "active" || m.status === "pending");
  if (!account || !mandate) return { error: "No card on file." };
  // Lead-only: the mandate read policy already only answers for the lead (or
  // finance), but verify against the account row before the admin write.
  const admin = createAdminClient();
  const [{ data: verify }, { data: profile }] = await Promise.all([
    admin.from("billing_accounts").select("id,lead_person_id").eq("id", account.id).maybeSingle(),
    admin.from("profiles").select("person_id").eq("id", session.userId).maybeSingle(),
  ]);
  if (!verify || !profile || verify.lead_person_id !== profile.person_id)
    return { error: "Only the lead member can remove the card." };
  await admin
    .from("payment_mandates")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", mandate.id);
  revalidatePath("/my-payments");
  return {};
}

export async function startMyAgreement(planId: string): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data: myRow } = await supabase
    .from("billing_account_people")
    .select("account_id")
    .is("removed_at", null)
    .limit(1)
    .maybeSingle();
  if (!myRow) return { error: "You have no membership number yet — the club will issue one." };
  const { error } = await supabase.rpc("start_agreement", {
    p_account_id: myRow.account_id,
    p_plan_id: planId,
  });
  if (error) return { error: error.message };
  revalidatePath("/my-payments");
  return {};
}
