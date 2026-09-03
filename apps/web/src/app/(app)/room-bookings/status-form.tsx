"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmBooking, cancelBooking, sendQuote } from "./actions";

export function StatusForm({
  bookingId,
  currentStatus,
  isStaff,
  defaultDepositPence = 0,
  currentTotalPence = null,
  currentDepositPence = null,
}: {
  bookingId: string;
  currentStatus: string;
  isStaff: boolean;
  defaultDepositPence?: number;
  currentTotalPence?: number | null;
  currentDepositPence?: number | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [totalPounds, setTotalPounds] = useState(
    currentTotalPence ? String(currentTotalPence / 100) : "",
  );
  const [depositPounds, setDepositPounds] = useState(
    String((currentDepositPence ?? defaultDepositPence) / 100 || ""),
  );

  const [quotePounds, setQuotePounds] = useState(
    currentTotalPence ? String(currentTotalPence / 100) : "",
  );

  async function runQuote() {
    setError(null);
    setLoading("quote");
    const result = await sendQuote(bookingId, {
      totalPence: quotePounds ? Math.round(Number(quotePounds) * 100) : null,
    });
    setLoading(null);
    if (result.error) setError(result.error);
    else { setConfirm(null); router.refresh(); }
  }

  async function runConfirm() {
    setError(null);
    setLoading("confirm");
    const result = await confirmBooking(bookingId, {
      totalPence: totalPounds ? Math.round(Number(totalPounds) * 100) : null,
      depositPence: depositPounds ? Math.round(Number(depositPounds) * 100) : 0,
    });
    setLoading(null);
    if (result.error) setError(result.error);
    else { setConfirm(null); router.refresh(); }
  }

  async function runCancel() {
    setError(null);
    if (!cancelReason.trim()) {
      setError("Please enter a cancellation reason.");
      return;
    }
    setLoading("cancel");
    const result = await cancelBooking(bookingId, cancelReason);
    setLoading(null);
    if (result.error) setError(result.error);
    else router.refresh();
  }

  if (!isStaff) return null;

  return (
    <div className="space-y-4">
      {/* Send a quote — prices the ask WITHOUT holding the slot; the
          status becomes 'quoted', which the no-overlap rule ignores exactly
          like 'enquiry'. Confirming later is what takes the date. */}
      {(currentStatus === "enquiry" || currentStatus === "pending" || currentStatus === "quoted") && (
        <>
          {confirm === "quote" ? (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">
                {currentStatus === "quoted" ? "Re-send the quote" : "Send a quote"}
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Quoted total (£)</label>
                <Input
                  type="number" min="0" step="0.01"
                  value={quotePounds}
                  onChange={(e) => setQuotePounds(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The booker is emailed the price with a room-not-held note. If nothing is
                confirmed within three days, one follow-up goes out automatically.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={runQuote} disabled={loading !== null} className="min-h-[44px] flex-1 lg:min-h-0 lg:flex-none">
                  {loading === "quote" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send quote"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirm(null)} className="min-h-[44px] lg:min-h-0">Back</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirm("quote")} disabled={loading !== null} className="min-h-[44px] w-full lg:min-h-0 lg:w-auto">
              {currentStatus === "quoted" ? "Re-quote" : "Send a quote"}
            </Button>
          )}
        </>
      )}

      {/* Confirm booking — from an enquiry or a quote too: confirming is the
          act that takes the slot, and the constraint arbitrates any race. */}
      {(currentStatus === "enquiry" || currentStatus === "quoted" || currentStatus === "pending") && (
        <>
          {confirm === "confirm" ? (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">Confirm booking</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">Total cost (£)</label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={totalPounds}
                    onChange={(e) => setTotalPounds(e.target.value)}
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">Deposit (£)</label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={depositPounds}
                    onChange={(e) => setDepositPounds(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The booker is emailed a confirmation with the total and deposit terms, plus a portal link to pay.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={runConfirm} disabled={loading !== null} className="min-h-[44px] flex-1 lg:min-h-0 lg:flex-none">
                  {loading === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & notify booker"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirm(null)} className="min-h-[44px] lg:min-h-0">Back</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirm("confirm")} disabled={loading !== null} className="min-h-[44px] w-full lg:min-h-0 lg:w-auto">
              Confirm booking
            </Button>
          )}
        </>
      )}

      {/* Cancel booking */}
      {(currentStatus === "enquiry" || currentStatus === "quoted" || currentStatus === "pending" || currentStatus === "confirmed") && (
        <>
          {confirm === "cancel" ? (
            <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive font-medium">
                  This cancellation reason will be emailed to the booker.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Cancellation reason *
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. The room is unavailable due to a prior commitment. We apologise for any inconvenience…"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={runCancel}
                  disabled={loading !== null || !cancelReason.trim()}
                  className="min-h-[44px] flex-1 lg:min-h-0 lg:flex-none"
                >
                  {loading === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send cancellation"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setConfirm(null); setCancelReason(""); }} className="min-h-[44px] lg:min-h-0">
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirm("cancel")}
              disabled={loading !== null}
              className="min-h-[44px] w-full border-destructive/40 text-destructive hover:bg-destructive/10 lg:min-h-0 lg:w-auto"
            >
              Cancel booking
            </Button>
          )}
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
