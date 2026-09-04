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
  type MyPlanOption,
} from "./my-payments-client";

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

  const [{ data: myRow }, { data: activePlans }] = await Promise.all([
    supabase
      .from("billing_account_people")
      .select("account_id,letter,billing_accounts(member_no,lead_person_id,status)")
      .is("removed_at", null)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("fee_plans")
      .select("id,name,amount_pence,schedule,scope,kind")
      .eq("active", true)
      .in("kind", ["membership", "subs"])
      .order("sort"),
  ]);

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

  const planOptions: MyPlanOption[] = isLead
    ? (activePlans ?? []).map((plan) => ({
        id: plan.id,
        name: plan.name,
        amount_pence: plan.amount_pence,
        schedule: plan.schedule,
      }))
    : [];

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
          plans={planOptions}
          isLead={isLead}
          sumupEnabled={isSumUpConfigured()}
        />
      </div>
    </>
  );
}
