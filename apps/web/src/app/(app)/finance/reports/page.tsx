import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFinance, formatMemberNo, CHARGE_KIND_LABELS } from "@/lib/finance";
import { isSumUpConfigured, listSumUpTransactions } from "@/lib/sumup-finance";
import { formatCurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Reports" };

/**
 * The reconciliation reports: arrears aging by membership, income by month
 * and plan, and the two-sided SumUp check — what SumUp settled versus what
 * the ledger recorded, so a missing webhook or a terminal payment that never
 * reached the book shows up as a difference, not a surprise.
 */
export default async function FinanceReportsPage() {
  await requireFinance();
  const supabase = await createClient();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: aging }, { data: income }, { data: recentSumUp }] = await Promise.all([
    supabase.from("finance_aging").select("*").order("outstanding_pence", { ascending: false }),
    supabase.from("finance_income_by_month").select("*").order("month", { ascending: false }).limit(60),
    supabase
      .from("payments")
      .select("amount_pence,refunded_pence,sumup_txn_code,paid_at")
      .eq("source", "sumup")
      .gte("paid_at", thirtyDaysAgo),
  ]);

  const sumupTransactions = isSumUpConfigured()
    ? await listSumUpTransactions({ oldestTime: thirtyDaysAgo }).catch(() => [])
    : [];
  const recordedCodes = new Set((recentSumUp ?? []).map((p) => p.sumup_txn_code).filter(Boolean));
  const successful = sumupTransactions.filter((t) => t.status === "SUCCESSFUL");
  const unmatched = successful.filter((t) => !recordedCodes.has(t.transaction_code));
  const sumupTotal = successful.reduce((acc, t) => acc + Math.round(t.amount * 100), 0);
  const ledgerTotal = (recentSumUp ?? []).reduce((acc, p) => acc + p.amount_pence, 0);

  const incomeRows = income ?? [];
  const months = [...new Set(incomeRows.map((r) => r.month))].sort().reverse().slice(0, 6);

  return (
    <>
      <PageHeader title="Reports" subtitle="Aging, income and the SumUp reconciliation" />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Arrears aging</CardTitle>
            <p className="text-sm text-muted-foreground">
              What each membership owes, by how long it has been owed. Chase the right-hand columns first.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Membership</th>
                    <th className="py-2 pr-3 text-right font-medium">Not yet due</th>
                    <th className="py-2 pr-3 text-right font-medium">0–30 days</th>
                    <th className="py-2 pr-3 text-right font-medium">31–60</th>
                    <th className="py-2 pr-3 text-right font-medium">61–90</th>
                    <th className="py-2 pr-3 text-right font-medium">90+</th>
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(aging ?? []).map((row) => (
                    <tr key={row.account_id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs text-muted-foreground">{formatMemberNo(row.member_no ?? 0)}</span>{" "}
                        {row.lead_name ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.not_due_pence ?? 0)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.d30_pence ?? 0)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.d60_pence ?? 0)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-destructive">{formatCurrency(row.d90_pence ?? 0)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium text-destructive">{formatCurrency(row.d90_plus_pence ?? 0)}</td>
                      <td className="py-2 text-right tabular-nums font-semibold">{formatCurrency(row.outstanding_pence ?? 0)}</td>
                    </tr>
                  ))}
                  {(aging ?? []).length === 0 && (
                    <tr><td colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Nothing outstanding — the book is clean.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Income by month</CardTitle>
            <p className="text-sm text-muted-foreground">Net of refunds, split by what the money was for.</p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <div className="space-y-4">
              {months.map((month) => {
                const rows = incomeRows.filter((r) => r.month === month);
                const total = rows.reduce((acc, r) => acc + (r.net_pence ?? 0), 0);
                return (
                  <div key={String(month)} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">
                        {new Date(String(month)).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
                      </p>
                      <p className="text-sm font-semibold tabular-nums">{formatCurrency(total)}</p>
                    </div>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {rows.map((r, i) => (
                        <li key={i} className="flex justify-between">
                          <span>
                            {r.plan_name ?? (r.kind ? (CHARGE_KIND_LABELS[r.kind] ?? r.kind) : "Other")}
                            {` · ${r.payment_count} payment${r.payment_count === 1 ? "" : "s"}`}
                          </span>
                          <span className="tabular-nums">{formatCurrency(r.net_pence ?? 0)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {months.length === 0 && <p className="text-sm text-muted-foreground">No income recorded yet.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">SumUp reconciliation (last 30 days)</CardTitle>
            <p className="text-sm text-muted-foreground">
              SumUp&apos;s settled transactions against the ledger. A row here means money SumUp took
              that the book has not recorded — investigate before it becomes a mystery.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            {!isSumUpConfigured() ? (
              <p className="text-sm text-muted-foreground">SumUp is not configured in this environment.</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">SumUp settled</p>
                    <p className="text-lg font-semibold tabular-nums">{formatCurrency(sumupTotal)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Ledger (SumUp source)</p>
                    <p className="text-lg font-semibold tabular-nums">{formatCurrency(ledgerTotal)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Unmatched transactions</p>
                    <p className={`text-lg font-semibold tabular-nums ${unmatched.length ? "text-destructive" : ""}`}>{unmatched.length}</p>
                  </div>
                </div>
                {unmatched.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {unmatched.map((t) => (
                      <li key={t.id} className="flex justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5">
                        <span className="font-mono text-xs">{t.transaction_code}</span>
                        <span>{new Date(t.timestamp).toLocaleString("en-GB")}</span>
                        <span className="tabular-nums">{formatCurrency(Math.round(t.amount * 100))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
