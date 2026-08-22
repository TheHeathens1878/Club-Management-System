"use client";

import { useState, useTransition } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { addPayment, deletePayment } from "./actions";

export type PaymentRow = {
  id: string;
  amount_pence: number;
  paid_at: string;
  method: string | null;
  reference: string | null;
  source: string;
  authorised_by_name: string | null;
  note: string | null;
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
  canDelete,
}: {
  bookingId: string;
  payments: PaymentRow[];
  totalPence: number;
  depositPence: number;
  canDelete: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayInput());
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const paidPence = payments.reduce((acc, p) => acc + p.amount_pence, 0);
  const outstanding = Math.max(0, totalPence - paidPence);
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
      {/* Totals */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border bg-muted/30 p-2">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-sm font-semibold">{totalPence > 0 ? formatCurrency(totalPence) : "—"}</p>
        </div>
        <div className="rounded-md border bg-muted/30 p-2">
          <p className="text-xs text-muted-foreground">Paid</p>
          <p className="text-sm font-semibold text-green-700">{formatCurrency(paidPence)}</p>
        </div>
        <div className="rounded-md border bg-muted/30 p-2">
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="text-sm font-semibold">{totalPence > 0 ? formatCurrency(outstanding) : "—"}</p>
        </div>
      </div>

      {depositPence > 0 && (
        <p className="text-xs text-muted-foreground">
          Deposit {formatCurrency(depositPence)} —{" "}
          {depositSatisfied
            ? <span className="text-green-700 font-medium">paid</span>
            : <span className="text-amber-700 font-medium">outstanding</span>}
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
                  <span className="text-muted-foreground">{METHOD_LABELS[p.method ?? ""] ?? p.method ?? "—"}</span>
                  {p.source === "sumup" && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">SumUp</span>
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
                  className="text-muted-foreground hover:text-destructive transition-colors p-1 shrink-0"
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
              <label className="text-xs font-medium text-muted-foreground uppercase">Amount (£)</label>
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
                className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
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
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase">Note</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            Email the booker a payment confirmation
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Record payment"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setAdding(false); setError(null); }}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Record payment
          </Button>
        </>
      )}
    </div>
  );
}
