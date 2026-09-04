import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFinance } from "@/lib/finance";
import { formatCurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";

/**
 * The finance section (Adam, 2026-09-04): everything the club charges and
 * collects, at the bill-payer. User-scoped client throughout — the views are
 * security_invoker and the finance role's own RLS is what opens the book.
 */
export default async function FinanceDashboardPage() {
  await requireFinance();
  const supabase = await createClient();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ data: summary }, { data: monthPayments }, { count: mandateCount }, { count: agreementCount }] =
    await Promise.all([
      supabase.from("finance_account_summary").select("*"),
      supabase
        .from("payments")
        .select("amount_pence,refunded_pence")
        .not("charge_id", "is", null)
        .gte("paid_at", monthStart.toISOString()),
      supabase
        .from("payment_mandates")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("billing_agreements")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
    ]);

  const rows = summary ?? [];
  const outstanding = rows.reduce((acc, r) => acc + Math.max(0, r.balance_pence ?? 0), 0);
  const overdue = rows.reduce((acc, r) => acc + Math.max(0, r.overdue_pence ?? 0), 0);
  const collectedThisMonth = (monthPayments ?? []).reduce(
    (acc, p) => acc + p.amount_pence - p.refunded_pence,
    0,
  );
  const numbered = rows.length;

  const kpis = [
    { label: "Outstanding", value: formatCurrency(outstanding), href: "/finance/charges" },
    { label: "Overdue", value: formatCurrency(overdue), href: "/finance/reports" },
    { label: "Collected this month", value: formatCurrency(collectedThisMonth), href: "/finance/payments" },
    { label: "Memberships numbered", value: String(numbered), href: "/finance/members" },
    { label: "Active agreements", value: String(agreementCount ?? 0), href: "/finance/charges" },
    { label: "Cards on file", value: String(mandateCount ?? 0), href: "/finance/settings" },
  ];

  const sections = [
    { href: "/finance/members", title: "Members & numbers", text: "Membership numbers, households under each bill-payer, issue new numbers." },
    { href: "/finance/plans", title: "Plans", text: "Membership fees, monthly subs, fines — bespoke options per cohort." },
    { href: "/finance/charges", title: "Charges & agreements", text: "Raise one-offs (yellow/red cards), waive, sign accounts up, collect stored cards." },
    { href: "/finance/payments", title: "Payments ledger", text: "Everything collected — SumUp, cash, bank transfer — with refunds." },
    { href: "/finance/reports", title: "Reports", text: "Arrears aging, income by month and plan, SumUp reconciliation." },
    { href: "/finance/export", title: "Xero export", text: "Sales invoices and bank statement CSVs, ready for Xero's importer." },
    { href: "/finance/settings", title: "Settings", text: "Xero account codes, tax type, cards on file." },
  ];

  return (
    <>
      <PageHeader title="Finance" subtitle="Subs, membership fees and everything the club collects" />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kpi) => (
            <Link key={kpi.label} href={kpi.href} className="rounded-lg border bg-card p-3 transition-colors hover:bg-secondary/50">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{kpi.value}</p>
            </Link>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => (
            <Link key={section.href} href={section.href}>
              <Card className="h-full transition-colors hover:bg-secondary/40">
                <CardHeader className="p-4">
                  <CardTitle className="text-base">{section.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">{section.text}</p>
                </CardHeader>
                <CardContent className="hidden p-0" />
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
