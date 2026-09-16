"use client";

import { useState, useTransition } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { sumHirePaid, sumSecurityPaid, type PaymentPurpose } from "@/lib/hire-terms";
import { addPayment, deletePayment } from "./actions";

export type PaymentRow = {
  id: string;
  amount_pence: number;
  /** Netted off the amount everywhere money is counted (20260912…, refunds net). */
  refunded_pence?: number | null;
  paid_at: string;
  method: string | null;
  reference: string | null;
  source: string;
  authorised_by_name: string | null;
  note: string | null;
  /** deposit | balance | security_deposit | null (hire, unlabelled). */
  purpose: string | null;
};

const PURPOSE_LABELS: Record<string, string> = {
  deposit: "Deposit",
  balance: "Balance",
  security_deposit: "Security deposit",
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  sumup: "SumUp",
  other: "Other",
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

export function PaymentsPanel({
  bookingId,
  payments,
  totalPence,
  depositPence,
  securityDepositPence = 0,
  canDelete,
}: {
  bookingId: string;
  payments: PaymentRow[];
  totalPence: number;
  depositPence: number;
  securityDepositPence?: number;
  canDelete: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayInput());
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [purpose, setPurpose] = useState<"hire" | PaymentPurpose>("hire");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Hire money and the security deposit are counted apart (20260913140000):
  // the security deposit is held for the event, not paid for the room.
  const paidPence = sumHirePaid(payments);
  const securityPaid = sumSecurityPaid(payments);
  const depositSatisfied = depositPence > 0 && paidPence >= depositPence;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const pounds = Number(amount);
    if (!pounds || pounds <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    startTransition(async () => {
      const result = await addPayment(bookingId, {
        amount_pence: Math.round(pounds * 100),
        paid_at: paidAt,
        method,
        reference: reference.trim() || null,
        note: note.trim() || null,
        send_email: sendEmail,
        purpose: purpose === "hire" ? null : purpose,
      });
      if (result?.error) {
        setError(result.error);
      } else {
        setAmount(""); setReference(""); setNote(""); setAdding(false);
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this payment? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deletePayment(id, bookingId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-4">
      {/* Total / Paid / Outstanding used to be repeated here in a third type
          size. The facts band above the page says it once now (P8.1), so this
          panel only says the two things the band does not: how the deposit
          stands, and how much security deposit is held. */}
      {depositPence > 0 && (
        <p className="text-xs text-muted-foreground">
          Non-refundable deposit {formatCurrency(depositPence)} —{" "}
          {depositSatisfied
            ? <span className="font-medium text-success">paid</span>
            : <span className="font-medium text-warning">outstanding</span>}
        </p>
      )}
      {securityDepositPence > 0 && (
        <p className="text-xs text-muted-foreground">
          Refundable security deposit {formatCurrency(securityDepositPence)} —{" "}
          {securityPaid >= securityDepositPence
            ? <span className="font-medium text-success">held</span>
            : securityPaid > 0
              ? <span className="font-medium text-warning">{formatCurrency(securityPaid)} held, {formatCurrency(securityDepositPence - securityPaid)} to come</span>
              : <span className="font-medium text-warning">not yet paid</span>}
          {" "}(due with the balance; not counted in the total)
        </p>
      )}

      {/* Payment list */}
      {payments.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {payments.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{formatCurrency(p.amount_pence)}</span>
                  {p.purpose ? (
                    <span className={"rounded px-1.5 py-0.5 text-2xs font-medium " + (p.purpose === "security_deposit" ? "bg-warning-tint text-warning" : "bg-secondary text-muted-foreground")}>
                      {PURPOSE_LABELS[p.purpose] ?? p.purpose}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">{METHOD_LABELS[p.method ?? ""] ?? p.method ?? "—"}</span>
                  {p.source === "sumup" && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">SumUp</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(p.paid_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  {p.authorised_by_name && <> · authorised by {p.authorised_by_name}</>}
                  {p.reference && <> · ref {p.reference}</>}
                </p>
                {p.note && <p className="text-xs text-muted-foreground italic">{p.note}</p>}
              </div>
              {canDelete && p.source !== "sumup" && (
                <button
                  onClick={() => handleDelete(p.id)}
                  disabled={isPending}
                  className="touch flex min-w-[44px] shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive lg:min-w-0"
                  title="Delete payment"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
      )}

      {/* Add payment */}
      {adding ? (
        <form onSubmit={handleAdd} className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Amount (£)
                {/* What is still owed, beside the box it is typed into — the
                    figure the desk would otherwise scroll up for. */}
                {totalPence > 0
                  ? ` — ${formatCurrency(Math.max(0, totalPence - paidPence))} outstanding`
                  : ""}
              </label>
              <Input
                type="number" min="0" step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">Date received</label>
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="touch h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">Reference</label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">What for</label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as "hire" | PaymentPurpose)}
                className="touch h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="hire">Room hire (deposit or balance)</option>
                <option value="deposit">Deposit</option>
                <option value="balance">Balance</option>
                <option value="security_deposit">Security deposit (held, refundable)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">Note</label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <label className="touch flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            Email the booker a payment confirmation
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending} className="touch flex-1 lg:flex-none">
              {isPending ? "Saving…" : "Record payment"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setAdding(false); setError(null); }} className="touch flex-1 lg:flex-none">
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="touch w-full gap-1.5 lg:w-auto">
            <Plus className="h-4 w-4" /> Record payment
          </Button>
        </>
      )}
    </div>
  );
}
