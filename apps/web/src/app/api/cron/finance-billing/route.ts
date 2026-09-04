import { NextResponse } from "next/server";

import { writeAudit } from "@/lib/audit";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { formatCurrency, getSiteUrl } from "@/lib/utils";
import {
  chargeStoredCard,
  isSumUpConfigured,
  listCustomerInstruments,
  recordSumUpChargePaymentIfPaid,
} from "@/lib/sumup-finance";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The daily billing cycle (Adam, 2026-09-04):
 *
 *   1. `run_billing_cycle()` raises every agreement charge that has come due
 *      (monthly subs, annual renewals).
 *   2. Auto-collection: pending charges on accounts with an ACTIVE stored
 *      card are collected server-side — agreement charges where the
 *      agreement says auto_collect, and fines where the mandate's
 *      covers_fines pre-authorisation stands.
 *   3. The lead member gets an email either way: a receipt when collection
 *      succeeded, a "please pay" note when a charge was raised and could not
 *      be collected.
 *
 * Vercel cron, daily 07:30 UTC. Idempotent end to end: the cycle only walks
 * forward, and payments are unique per SumUp checkout.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const summary = { raised: 0, collected: 0, collectFailed: 0, emailed: 0 };

  // 1. Raise what has come due.
  const { data: raised, error: cycleError } = await admin.rpc("run_billing_cycle");
  if (cycleError) {
    console.error("[finance-billing] run_billing_cycle failed:", cycleError);
    return NextResponse.json({ error: cycleError.message }, { status: 500 });
  }
  summary.raised = raised ?? 0;

  // 2. Auto-collect where a mandate stands.
  if (isSumUpConfigured()) {
    const [{ data: mandateRows }, { data: pending }] = await Promise.all([
      admin
        .from("payment_mandates")
        .select("account_id,sumup_customer_id,covers_fines")
        .eq("status", "active"),
      admin
        .from("charges")
        .select("id,charge_no,account_id,kind,description,amount_pence,agreement_id,billing_agreements(auto_collect)")
        .eq("status", "pending")
        .lte("due_on", new Date().toISOString().slice(0, 10)),
    ]);
    const mandateByAccount = new Map((mandateRows ?? []).map((m) => [m.account_id, m]));

    for (const charge of pending ?? []) {
      const mandate = mandateByAccount.get(charge.account_id);
      if (!mandate) continue;
      const authorised =
        (charge.agreement_id && charge.billing_agreements?.auto_collect) ||
        (charge.kind === "fine" && mandate.covers_fines);
      if (!authorised) continue;

      try {
        const instruments = await listCustomerInstruments(mandate.sumup_customer_id);
        const instrument = instruments.find((i) => i.active);
        if (!instrument) continue;
        const checkout = await chargeStoredCard({
          chargeId: charge.id,
          amountPence: charge.amount_pence,
          description: charge.description,
          customerId: mandate.sumup_customer_id,
          token: instrument.token,
        });
        const result = await recordSumUpChargePaymentIfPaid(checkout.id);
        if (result.recorded || result.present) summary.collected += 1;
        else summary.collectFailed += 1;
      } catch (e) {
        console.error(`[finance-billing] auto-collect failed for charge ${charge.id}:`, e);
        summary.collectFailed += 1;
      }
    }
  }

  // 3. Tell the lead member what happened today.
  if (isEmailConfigured()) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: todaysCharges } = await admin
      .from("charges")
      .select("id,description,amount_pence,status,account_id,billing_accounts(lead_person_id)")
      .gte("created_at", since);

    const byLead = new Map<string, { description: string; amount_pence: number; status: string }[]>();
    for (const charge of todaysCharges ?? []) {
      const lead = charge.billing_accounts?.lead_person_id;
      if (!lead) continue;
      const list = byLead.get(lead) ?? [];
      list.push({ description: charge.description, amount_pence: charge.amount_pence, status: charge.status });
      byLead.set(lead, list);
    }
    if (byLead.size > 0) {
      const { data: leads } = await admin
        .from("people")
        .select("id,first_name,email")
        .in("id", [...byLead.keys()]);
      for (const lead of leads ?? []) {
        if (!lead.email) continue;
        const items = byLead.get(lead.id) ?? [];
        const collected = items.filter((i) => i.status === "paid");
        const owed = items.filter((i) => i.status === "pending");
        const lines = [
          ...collected.map((i) => `<li>${i.description} — ${formatCurrency(i.amount_pence)} collected from your saved card</li>`),
          ...owed.map((i) => `<li>${i.description} — ${formatCurrency(i.amount_pence)} to pay</li>`),
        ].join("");
        try {
          await sendEmail({
            to: lead.email,
            subject: owed.length > 0 ? "Your club membership — payment due" : "Your club membership — payment receipt",
            html: `<p>Hi ${lead.first_name},</p><ul>${lines}</ul><p>${
              owed.length > 0
                ? `You can pay online at <a href="${getSiteUrl()}/my-payments">${getSiteUrl()}/my-payments</a>.`
                : "Nothing more to do — thank you."
            }</p><p>AoM Sports Club</p>`,
            category: "reminder",
            entity: "charges",
          });
          summary.emailed += 1;
        } catch (e) {
          console.error(`[finance-billing] email to lead ${lead.id} failed:`, e);
        }
      }
    }
  }

  await writeAudit({
    actorId: null,
    actorEmail: "cron",
    action: "finance.billing_run",
    entity: "charges",
    detail: summary,
  });

  return NextResponse.json(summary);
}
