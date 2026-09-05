import { NextResponse } from "next/server";

import { writeAudit } from "@/lib/audit";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { formatCurrency, getSiteUrl } from "@/lib/utils";
import {
  collectChargeFromStoredCard,
  isSumUpConfigured,
  listCustomerInstruments,
  type SumUpInstrument,
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
 * forward, and every collection goes through `collectChargeFromStoredCard`,
 * which claims a `collection_attempts` row before it asks SumUp for anything
 * and reconciles any earlier unfinished attempt first — so a run that died
 * after the card was charged is recorded, not repeated, and two overlapping
 * runs cannot both collect the same charge (Codex review, findings 4 and 5).
 * The amount collected is what is still outstanding, never the face value.
 */
const PAGE = 200;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const summary = { raised: 0, collected: 0, skipped: 0, collectFailed: 0, emailed: 0 };

  // 1. Raise what has come due.
  const { data: raised, error: cycleError } = await admin.rpc("run_billing_cycle");
  if (cycleError) {
    console.error("[finance-billing] run_billing_cycle failed:", cycleError);
    return NextResponse.json({ error: cycleError.message }, { status: 500 });
  }
  summary.raised = raised ?? 0;

  // 2. Auto-collect where a mandate stands.
  if (isSumUpConfigured()) {
    const { data: mandateRows } = await admin
      .from("payment_mandates")
      .select("account_id,sumup_customer_id,covers_fines")
      .eq("status", "active");
    const mandateByAccount = new Map((mandateRows ?? []).map((m) => [m.account_id, m]));
    // One instrument lookup per customer per run, not per charge.
    const instrumentByCustomer = new Map<string, SumUpInstrument | null>();
    const today = new Date().toISOString().slice(0, 10);

    // Keyset pages ordered by id: a charge that settles mid-run drops out of
    // the pending set without shifting the ones after it, which an offset
    // page would skip.
    let afterId: string | null = null;
    for (;;) {
      let query = admin
        .from("charges")
        .select("id,charge_no,account_id,kind,description,amount_pence,agreement_id,billing_agreements(auto_collect)")
        .eq("status", "pending")
        .lte("due_on", today)
        .order("id")
        .limit(PAGE);
      if (afterId) query = query.gt("id", afterId);
      const { data: page, error: pageError } = await query;
      if (pageError) {
        console.error("[finance-billing] reading pending charges failed:", pageError);
        break;
      }
      const charges = page ?? [];

      for (const charge of charges) {
        const mandate = mandateByAccount.get(charge.account_id);
        if (!mandate) continue;
        const authorised =
          (charge.agreement_id && charge.billing_agreements?.auto_collect) ||
          (charge.kind === "fine" && mandate.covers_fines);
        if (!authorised) continue;

        try {
          let instrument = instrumentByCustomer.get(mandate.sumup_customer_id);
          if (instrument === undefined) {
            const instruments = await listCustomerInstruments(mandate.sumup_customer_id);
            instrument = instruments.find((i) => i.active) ?? null;
            instrumentByCustomer.set(mandate.sumup_customer_id, instrument);
          }
          if (!instrument) continue;

          const result = await collectChargeFromStoredCard({
            chargeId: charge.id,
            description: charge.description,
            customerId: mandate.sumup_customer_id,
            token: instrument.token,
          });
          if (result.outcome === "collected" || result.outcome === "recovered") {
            summary.collected += 1;
          } else if (result.outcome === "failed") {
            console.error(`[finance-billing] auto-collect failed for charge ${charge.id}: ${result.reason}`);
            summary.collectFailed += 1;
          } else {
            summary.skipped += 1;
          }
        } catch (e) {
          console.error(`[finance-billing] auto-collect failed for charge ${charge.id}:`, e);
          summary.collectFailed += 1;
        }
      }

      if (charges.length < PAGE) break;
      afterId = charges[charges.length - 1]!.id;
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
