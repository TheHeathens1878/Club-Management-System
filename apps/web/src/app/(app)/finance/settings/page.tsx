import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFinance, formatMemberNo } from "@/lib/finance";
import { createClient } from "@/lib/supabase/server";

import { SettingsClient, type MandateRow } from "./settings-client";

export default async function FinanceSettingsPage() {
  await requireFinance();
  const supabase = await createClient();

  const [{ data: settingRows }, { data: mandates }] = await Promise.all([
    supabase.from("site_settings").select("key,value").like("key", "finance.%"),
    supabase
      .from("payment_mandates")
      .select("id,status,card_last4,card_type,covers_fines,consented_at,billing_accounts(member_no,lead_person_id)")
      .order("created_at", { ascending: false }),
  ]);

  const settings: Record<string, string> = {};
  for (const row of settingRows ?? []) settings[row.key] = row.value;

  const accountIds = (mandates ?? [])
    .map((m) => m.billing_accounts?.lead_person_id)
    .filter((id): id is string => !!id);
  const { data: leads } = accountIds.length
    ? await supabase.from("people").select("id,first_name,last_name").in("id", accountIds)
    : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const nameById = new Map((leads ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`]));

  const mandateRows: MandateRow[] = (mandates ?? []).map((mandate) => ({
    id: mandate.id,
    member_no: mandate.billing_accounts ? formatMemberNo(mandate.billing_accounts.member_no) : "—",
    lead_name: mandate.billing_accounts
      ? (nameById.get(mandate.billing_accounts.lead_person_id) ?? "—")
      : "—",
    status: mandate.status,
    card: mandate.card_last4 ? `${mandate.card_type ?? "card"} ····${mandate.card_last4}` : "—",
    covers_fines: mandate.covers_fines,
    consented_at: mandate.consented_at,
  }));

  return (
    <>
      <PageHeader title="Finance settings" subtitle="Xero mapping and cards on file" />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Settings</CardTitle>
            <p className="text-sm text-muted-foreground">
              The Xero account code each kind of charge posts to, and the tax type on exported
              invoices.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <SettingsClient settings={settings} mandates={mandateRows} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
