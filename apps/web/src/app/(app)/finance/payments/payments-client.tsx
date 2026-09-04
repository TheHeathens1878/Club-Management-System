"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";

import { refundPayment, type ActionState } from "../actions";

const EMPTY: ActionState = {};

export type PaymentRow = {
  id: string;
  kind: string;
  amount_pence: number;
  refunded_pence: number;
  paid_at: string | null;
  method: string | null;
  source: string | null;
  reference: string | null;
  detail: string;
};

const KIND_LABELS: Record<string, string> = {
  hire: "Hire",
  subscription: "Subs (legacy)",
  charge: "Club",
  other: "Other",
};

function money(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error)
    return <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>;
  if (state.notice)
    return <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.notice}</p>;
  return null;
}

export function PaymentsClient({
  payments,
  filterKind,
  from,
  to,
}: {
  payments: PaymentRow[];
  filterKind: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [refunding, setRefunding] = useState<string | null>(null);
  const [refundState, refundAction] = useActionState(refundPayment, EMPTY);

  function applyFilter(next: { kind?: string; from?: string; to?: string }) {
    const params = new URLSearchParams();
    const kind = next.kind ?? filterKind;
    const f = next.from ?? from;
    const t = next.to ?? to;
    if (kind) params.set("kind", kind);
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    router.push(`/finance/payments?${params.toString()}`);
  }

  const total = payments.reduce((acc, p) => acc + p.amount_pence - p.refunded_pence, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1">
          {["", "charge", "hire", "subscription", "other"].map((kind) => (
            <button
              key={kind || "all"}
              type="button"
              onClick={() => applyFilter({ kind })}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${filterKind === kind ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
            >
              {kind === "" ? "All" : KIND_LABELS[kind]}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="pay-from">From</Label>
          <Input id="pay-from" type="date" defaultValue={from} onChange={(e) => applyFilter({ from: e.target.value })} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="pay-to">To</Label>
          <Input id="pay-to" type="date" defaultValue={to} onChange={(e) => applyFilter({ to: e.target.value })} className="w-40" />
        </div>
        <p className="ml-auto text-sm tabular-nums text-muted-foreground">
          {payments.length} payments · net {money(total)}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">When</th>
              <th className="py-2 pr-3 font-medium">What</th>
              <th className="py-2 pr-3 font-medium">Method</th>
              <th className="py-2 pr-3 font-medium">Reference</th>
              <th className="py-2 pr-3 text-right font-medium">Amount</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id} className="border-b last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                  {payment.paid_at ? new Date(payment.paid_at).toLocaleDateString("en-GB") : "—"}
                </td>
                <td className="py-2 pr-3">
                  <Badge variant="outline">{KIND_LABELS[payment.kind] ?? payment.kind}</Badge>{" "}
                  <span className="text-xs">{payment.detail}</span>
                </td>
                <td className="py-2 pr-3 text-xs">{payment.method ?? "—"}</td>
                <td className="py-2 pr-3 font-mono text-xs">{payment.reference ?? "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {money(payment.amount_pence)}
                  {payment.refunded_pence > 0 && (
                    <span className="block text-xs text-destructive">−{money(payment.refunded_pence)} refunded</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {payment.kind === "charge" && payment.refunded_pence < payment.amount_pence && (
                    refunding === payment.id ? (
                      <form action={refundAction} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="payment_id" value={payment.id} />
                        <Input
                          name="amount"
                          inputMode="decimal"
                          defaultValue={((payment.amount_pence - payment.refunded_pence) / 100).toFixed(2)}
                          className="h-8 w-24"
                          aria-label="Refund amount £"
                        />
                        <button type="submit" className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-secondary">OK</button>
                        <button type="button" onClick={() => setRefunding(null)} className="text-xs text-muted-foreground underline">cancel</button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRefunding(payment.id)}
                        className="text-xs text-muted-foreground underline hover:text-destructive"
                      >
                        refund
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No payments in this range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Feedback state={refundState} />
    </div>
  );
}
