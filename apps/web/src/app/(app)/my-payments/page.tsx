import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities } from "@/lib/capabilities";
import { isSumUpConfigured } from "@/lib/sumup";
import { createClient } from "@/lib/supabase/server";

import {
  MyPaymentsClient,
  type MyAgreement,
  type MyCharge,
  type MyMandate,
  type MyQuote,
} from "./my-payments-client";

export const metadata = { title: "My payments" };

/**
 * The household's money, live (Adam, 2026-09-04: "members should be able to
 * see their payments in real time"). Everything reads through the caller's
 * own RLS: a household member sees their account's charges and the payments
 * against them the moment they land — Realtime rides the same policies.
 */
export default async function MyPaymentsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const capabilities = await getCapabilities();

  const supabase = await createClient();

  const { data: myRow } = await supabase
    .from("billing_account_people")
    .select("account_id,letter,billing_accounts(member_no,lead_person_id,status)")
    .is("removed_at", null)
    .limit(1)
    .maybeSingle();

  if (!myRow || !myRow.billing_accounts) {
    return (
      <>
        <PageHeader title="My payments" subtitle="Charges and payments for your membership" />
        <div className="p-4 lg:p-6">
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              You don&apos;t have a membership number yet. The club issues one when your membership is
              set up — nothing for you to do.
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const accountId = myRow.account_id;
  const isLead = capabilities.personId === myRow.billing_accounts.lead_person_id;

  const [{ data: charges }, { data: agreements }, { data: mandates }, { data: household }] =
    await Promise.all([
      supabase
        .from("charges")
        .select("id,charge_no,kind,description,amount_pence,due_on,status,created_at,people(first_name,last_name),payments(id,amount_pence,refunded_pence,paid_at,method,source)")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
      supabase
        .from("billing_agreements")
        .select("id,status,next_charge_on,months_total,months_charged,auto_collect,fee_plans(name,amount_pence,schedule)")
        .eq("account_id", accountId)
        .in("status", ["active", "paused"]),
      supabase
        .from("payment_mandates")
        .select("id,status,card_last4,card_type,covers_fines")
        .eq("account_id", accountId)
        .in("status", ["pending", "active"]),
      supabase
        .from("billing_account_people")
        .select("person_id,letter,people(first_name,last_name)")
        .eq("account_id", accountId)
        .is("removed_at", null)
        .order("letter"),
    ]);

  const chargeRows: MyCharge[] = (charges ?? []).map((charge) => ({
    id: charge.id,
    charge_no: charge.charge_no,
    kind: charge.kind,
    description: charge.description,
    amount_pence: charge.amount_pence,
    due_on: charge.due_on,
    status: charge.status,
    for_name: charge.people ? `${charge.people.first_name} ${charge.people.last_name}` : null,
    payments: (charge.payments ?? [])
      .sort((a, b) => (a.paid_at ?? "").localeCompare(b.paid_at ?? ""))
      .map((payment) => ({
        id: payment.id,
        amount_pence: payment.amount_pence,
        refunded_pence: payment.refunded_pence,
        paid_at: payment.paid_at,
        method: payment.method,
      })),
  }));

  const agreementRows: MyAgreement[] = (agreements ?? []).map((agreement) => ({
    id: agreement.id,
    plan_name: agreement.fee_plans?.name ?? "—",
    amount_pence: agreement.fee_plans?.amount_pence ?? 0,
    schedule: agreement.fee_plans?.schedule ?? "monthly",
    next_charge_on: agreement.next_charge_on,
    months_total: agreement.months_total,
    months_charged: agreement.months_charged,
  }));

  const firstMandate = (mandates ?? [])[0];
  const mandate: MyMandate | null = firstMandate
    ? {
        id: firstMandate.id,
        status: firstMandate.status,
        card: firstMandate.card_last4 ? `${firstMandate.card_type ?? "card"} ····${firstMandate.card_last4}` : null,
        covers_fines: firstMandate.covers_fines,
      }
    : null;

  // Already enrolled this season? (Up-front enrolments are completed, so ask
  // the season-stamped rows, not just the live ones.)
  const { data: enrolmentRows } = await supabase
    .from("billing_agreements")
    .select("id,season_id,status,seasons(is_current)")
    .eq("account_id", accountId)
    .not("season_id", "is", null)
    .in("status", ["active", "paused", "completed"]);
  const enrolled = (enrolmentRows ?? []).some((row) => row.seasons?.is_current);

  // The one sum, for the lead of an un-enrolled household. subs_quote raises
  // while the fees are inactive or no season is current — both simply mean
  // "nothing to offer yet".
  // Why there is no quote matters as much as the quote (Adam, 2026-09-04:
  // "My payments doesn't have any options") — an empty page and a page that
  // says "sign-up opens when the club saves its fees" are different things.
  let quote: MyQuote | null = null;
  let quoteNote: string | null = null;
  if (!enrolled) {
    if (!isLead) {
      quoteNote = "Membership sign-up is done by your lead member — the bill-payer for your household.";
    } else {
      const { data: quoteRows, error: quoteError } = await supabase.rpc("subs_quote", {
        p_account_id: accountId,
      });
      const q = Array.isArray(quoteRows) ? quoteRows[0] : null;
      if (q) {
        quote = {
          scope: q.scope,
          season_name: q.season_name,
          membership_pence: q.membership_pence,
          monthly_pence: q.monthly_pence,
          instalments: q.instalments,
          first_on: q.first_on,
          last_on: q.last_on,
          total_pence: q.total_pence,
        };
      } else if (quoteError?.message.includes("not active")) {
        quoteNote = capabilities.hasFinanceRole
          ? "Sign-up is not open yet: the fees for your household's scope are not active. Save & activate them in Finance → Fees."
          : "Membership sign-up isn't open yet — the club is still setting this season's fees. Check back soon.";
      } else if (quoteError?.message.includes("no current season")) {
        quoteNote = "Membership sign-up isn't open yet — the club has not started the new season.";
      } else if (quoteError) {
        quoteNote = "Membership sign-up isn't available right now.";
      }
    }
  }

  const memberNo = myRow.billing_accounts.member_no;

  return (
    <>
      <PageHeader
        title="My payments"
        subtitle={`Membership ${String(memberNo).padStart(5, "0")} — ${(household ?? []).length} member${(household ?? []).length === 1 ? "" : "s"}`}
      />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <MyPaymentsClient
          accountId={accountId}
          charges={chargeRows}
          agreements={agreementRows}
          mandate={mandate}
          quote={quote}
          quoteNote={quoteNote}
          isLead={isLead}
          sumupEnabled={isSumUpConfigured()}
        />
      </div>
    </>
  );
}
