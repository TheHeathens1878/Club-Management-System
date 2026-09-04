import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFinance } from "@/lib/finance";
import { createClient } from "@/lib/supabase/server";

import { PaymentsClient, type PaymentRow } from "./payments-client";

/**
 * The one ledger, whole: function-room hire, subs, membership fees, fines —
 * every payment the club has recorded, with refunds netted where they belong.
 * The finance role reads it all (payments_finance_read).
 */
export default async function FinancePaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; from?: string; to?: string }>;
}) {
  await requireFinance();
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("payments")
    .select(
      "id,kind,amount_pence,refunded_pence,paid_at,method,source,reference,note,sumup_txn_code,charges(charge_no,description,billing_accounts(member_no)),bookings(booker_name)",
    )
    .order("paid_at", { ascending: false })
    .limit(500);
  if (params.kind && ["hire", "subscription", "charge", "other"].includes(params.kind)) {
    query = query.eq("kind", params.kind as "hire" | "subscription" | "charge" | "other");
  }
  if (params.from) query = query.gte("paid_at", params.from);
  if (params.to) query = query.lte("paid_at", `${params.to}T23:59:59`);

  const { data: payments } = await query;

  const rows: PaymentRow[] = (payments ?? []).map((payment) => ({
    id: payment.id,
    kind: payment.kind,
    amount_pence: payment.amount_pence,
    refunded_pence: payment.refunded_pence,
    paid_at: payment.paid_at,
    method: payment.method,
    source: payment.source,
    reference: payment.reference ?? payment.sumup_txn_code ?? null,
    detail: payment.charges
      ? `CHG-${payment.charges.charge_no} · ${payment.charges.description}` +
        (payment.charges.billing_accounts
          ? ` · ${String(payment.charges.billing_accounts.member_no).padStart(5, "0")}`
          : "")
      : payment.bookings
        ? `Hire · ${payment.bookings.booker_name}`
        : (payment.note ?? "—"),
  }));

  return (
    <>
      <PageHeader title="Payments ledger" subtitle="Everything collected, one book" />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Payments</CardTitle>
            <p className="text-sm text-muted-foreground">
              SumUp, cash and bank transfers land here alike. Refunds are recorded against the
              original payment, never deleted.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <PaymentsClient payments={rows} filterKind={params.kind ?? ""} from={params.from ?? ""} to={params.to ?? ""} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
