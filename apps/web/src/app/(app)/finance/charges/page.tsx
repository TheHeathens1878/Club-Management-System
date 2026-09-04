import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFinance } from "@/lib/finance";
import { createClient } from "@/lib/supabase/server";

import {
  ChargesClient,
  type AgreementRow,
  type ChargeRow,
  type PickerOption,
} from "./charges-client";

/**
 * The book of charges: what every membership owes and why, with the tools —
 * raise a one-off (yellow/red card fines from their plans), waive with a
 * reason, void a mistake, collect from a stored card, run agreements.
 */
export default async function FinanceChargesPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; status?: string }>;
}) {
  const { capabilities } = await requireFinance();
  const params = await searchParams;
  const supabase = await createClient();

  let chargeQuery = supabase
    .from("charges")
    .select(
      "id,charge_no,account_id,agreement_id,plan_id,person_id,kind,description,amount_pence,due_on,status,waived_reason,created_at,fee_plans(name),billing_accounts(member_no,lead_person_id),people(first_name,last_name),payments(amount_pence,refunded_pence)",
    )
    .order("created_at", { ascending: false })
    .limit(400);
  if (params.account) chargeQuery = chargeQuery.eq("account_id", params.account);
  if (params.status && ["pending", "paid", "waived", "void"].includes(params.status)) {
    chargeQuery = chargeQuery.eq("status", params.status as "pending" | "paid" | "waived" | "void");
  }

  const [{ data: charges }, { data: agreements }, { data: plans }, { data: accountPeople }, { data: mandates }] =
    await Promise.all([
      chargeQuery,
      supabase
        .from("billing_agreements")
        .select("id,account_id,status,start_on,next_charge_on,months_total,months_charged,auto_collect,fee_plans(name,amount_pence,schedule),billing_accounts(member_no)")
        .in("status", ["active", "paused"])
        .order("next_charge_on", { ascending: true, nullsFirst: false }),
      supabase.from("fee_plans").select("id,name,kind,amount_pence,schedule,active").order("sort"),
      supabase
        .from("billing_account_people")
        .select("account_id,person_id,letter,removed_at,people(first_name,last_name),billing_accounts(member_no,lead_person_id)")
        .is("removed_at", null)
        .order("letter"),
      supabase.from("payment_mandates").select("account_id,status").eq("status", "active"),
    ]);

  const mandateAccounts = new Set((mandates ?? []).map((m) => m.account_id));
  const leadNameByAccount = new Map<string, string>();
  for (const row of accountPeople ?? []) {
    if (row.billing_accounts?.lead_person_id === row.person_id && row.people) {
      leadNameByAccount.set(row.account_id, `${row.people.first_name} ${row.people.last_name}`);
    }
  }

  const chargeRows: ChargeRow[] = (charges ?? []).map((charge) => {
    const paid = (charge.payments ?? []).reduce((acc, p) => acc + p.amount_pence - p.refunded_pence, 0);
    return {
      id: charge.id,
      charge_no: charge.charge_no,
      account_id: charge.account_id,
      member_no: charge.billing_accounts?.member_no ?? 0,
      lead_name: leadNameByAccount.get(charge.account_id) ?? "—",
      person_name: charge.people ? `${charge.people.first_name} ${charge.people.last_name}` : null,
      kind: charge.kind,
      description: charge.description,
      plan_name: charge.fee_plans?.name ?? null,
      amount_pence: charge.amount_pence,
      paid_pence: paid,
      due_on: charge.due_on,
      status: charge.status,
      waived_reason: charge.waived_reason,
      mandate: mandateAccounts.has(charge.account_id),
    };
  });

  const agreementRows: AgreementRow[] = (agreements ?? []).map((agreement) => ({
    id: agreement.id,
    member_no: agreement.billing_accounts?.member_no ?? 0,
    lead_name: leadNameByAccount.get(agreement.account_id) ?? "—",
    plan_name: agreement.fee_plans?.name ?? "—",
    amount_pence: agreement.fee_plans?.amount_pence ?? 0,
    schedule: agreement.fee_plans?.schedule ?? "monthly",
    status: agreement.status,
    next_charge_on: agreement.next_charge_on,
    months_total: agreement.months_total,
    months_charged: agreement.months_charged,
    auto_collect: agreement.auto_collect,
  }));

  const peoplePicker: PickerOption[] = (accountPeople ?? [])
    .filter((row) => row.people)
    .map((row) => ({
      id: row.person_id,
      name: `${row.people!.first_name} ${row.people!.last_name} (${String(row.billing_accounts?.member_no ?? 0).padStart(5, "0")}${row.letter})`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const accountPicker: PickerOption[] = [...leadNameByAccount.entries()]
    .map(([id, name]) => {
      const memberNo = (accountPeople ?? []).find((row) => row.account_id === id)?.billing_accounts?.member_no ?? 0;
      return { id, name: `${String(memberNo).padStart(5, "0")} — ${name}`, sortKey: memberNo };
    })
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ id, name }) => ({ id, name }));

  const planPicker: PickerOption[] = (plans ?? [])
    .filter((plan) => plan.active)
    .map((plan) => ({ id: plan.id, name: `${plan.name} — £${(plan.amount_pence / 100).toFixed(2)}` }));

  return (
    <>
      <PageHeader title="Charges & agreements" subtitle="What every membership owes, and why" />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Charges</CardTitle>
            <p className="text-sm text-muted-foreground">
              Every charge is billed to the lead member. A fine names the player who incurred it; the
              bill still lands on the bill-payer. Collect takes the money from the stored card where
              one is on file.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <ChargesClient
              charges={chargeRows}
              agreements={agreementRows}
              people={peoplePicker}
              accounts={accountPicker}
              plans={planPicker}
              filterStatus={params.status ?? ""}
              isSuperUser={capabilities.isSuperUser}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
