"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmBooking, cancelBooking, sendChaser, sendFinalChaser, sendQuote } from "./actions";

function whenSent(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function StatusForm({
  bookingId,
  currentStatus,
  isStaff,
  defaultDepositPence = 0,
  currentTotalPence = null,
  currentDepositPence = null,
  defaultMemberDiscountPence = null,
  chaserSentAt = null,
  finalChaserSentAt = null,
  finalChaserDiscountPence = null,
}: {
  bookingId: string;
  currentStatus: string;
  isStaff: boolean;
  defaultDepositPence?: number;
  currentTotalPence?: number | null;
  currentDepositPence?: number | null;
  /** The club's configured discount — prefilled when a claim is on the booking. */
  defaultMemberDiscountPence?: number | null;
  /** The chasers (Adam, 2026-09-11): when each last went, and what the final one took off. */
  chaserSentAt?: string | null;
  finalChaserSentAt?: string | null;
  finalChaserDiscountPence?: number | null;
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
  const [discountPounds, setDiscountPounds] = useState(
    defaultMemberDiscountPence ? (defaultMemberDiscountPence / 100).toFixed(2) : "",
  );

  const [quotePounds, setQuotePounds] = useState(
    currentTotalPence ? String(currentTotalPence / 100) : "",
  );
  const [quoteMessage, setQuoteMessage] = useState("");

  async function runQuote() {
    setError(null);
    setLoading("quote");
    const result = await sendQuote(bookingId, {
      totalPence: quotePounds ? Math.round(Number(quotePounds) * 100) : null,
      message: quoteMessage,
    });
    setLoading(null);
    if (result.error) setError(result.error);
    else { setConfirm(null); router.refresh(); }
  }

  async function runChaser() {
    setError(null);
    setLoading("chaser");
    const result = await sendChaser(bookingId);
    setLoading(null);
    if (result.error) setError(result.error);
    else { setConfirm(null); router.refresh(); }
  }

  async function runFinalChaser() {
    setError(null);
    setLoading("final");
    const result = await sendFinalChaser(bookingId);
    setLoading(null);
    if (result.error) setError(result.error);
    else { setConfirm(null); router.refresh(); }
  }

  const canChase = currentStatus === "enquiry" || currentStatus === "quoted";
  const halfHire = currentTotalPence ? Math.round(currentTotalPence / 2) : 0;

  async function runConfirm() {
    setError(null);
    setLoading("confirm");
    const result = await confirmBooking(bookingId, {
      totalPence: totalPounds ? Math.round(Number(totalPounds) * 100) : null,
      depositPence: depositPounds ? Math.round(Number(depositPounds) * 100) : 0,
      memberDiscountPence: discountPounds ? Math.round(Number(discountPounds) * 100) : null,
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
      {(currentStatus === "enquiry" || currentStatus === "pending" || currentStatus === "quoted" || currentStatus === "cancelled") && (
        <>
          {confirm === "quote" ? (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">
                {currentStatus === "quoted"
                  ? "Re-send the quote"
                  : currentStatus === "cancelled"
                    ? "Re-quote this cancelled booking"
                    : "Send a quote"}
              </p>
              {currentStatus === "cancelled" && (
                <p className="text-xs text-muted-foreground">
                  Reopens it as a quote — the room is not held until it is confirmed again, and the old
                  deposit deadline is cleared.
                </p>
              )}
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
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Message to include (optional)</label>
                <textarea
                  value={quoteMessage}
                  onChange={(e) => setQuoteMessage(e.target.value)}
                  rows={3}
                  placeholder="Anything you want to say alongside the price — goes in the quote email, under the price."
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
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
              {currentStatus === "quoted"
                ? "Re-quote"
                : currentStatus === "cancelled"
                  ? "Re-quote & reopen"
                  : "Send a quote"}
            </Button>
          )}
        </>
      )}

      {/* The chasers (Adam, 2026-09-11). The first only asks and can go again;
          the second halves the room hire, amends the quote to match, and goes
          once. Neither holds the room. */}
      {canChase && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Chase this booker</p>
          {confirm === "chaser" ? (
            <div className="space-y-2">
              <p className="text-sm">
                Email {currentStatus === "quoted" ? "the booker" : "the enquirer"} asking whether they still want the room
                {currentTotalPence ? ", repeating the quoted price" : ""}. Nothing is held.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={runChaser} disabled={loading !== null} className="min-h-[44px] flex-1 lg:min-h-0 lg:flex-none">
                  {loading === "chaser" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send chaser"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirm(null)} className="min-h-[44px] lg:min-h-0">Back</Button>
              </div>
            </div>
          ) : confirm === "final" ? (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">Final offer — half off the room hire</p>
              <p className="text-xs text-amber-900">
                The quote is amended to the new price before the email goes, the booking becomes a quote,
                and this cannot be sent twice.
                {currentTotalPence
                  ? ` The price is ${(currentTotalPence / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" })} now; the offer will be about ${(halfHire / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" })} off (exactly half the room hire — extras stay at their price).`
                  : " Send a quote first: there is no price to halve."}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={runFinalChaser} disabled={loading !== null || !currentTotalPence} className="min-h-[44px] flex-1 lg:min-h-0 lg:flex-none">
                  {loading === "final" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Amend quote & send final offer"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirm(null)} className="min-h-[44px] lg:min-h-0">Back</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setConfirm("chaser")} disabled={loading !== null} className="min-h-[44px] lg:min-h-0">
                {chaserSentAt ? "Send chaser again" : "Send chaser"}
              </Button>
              {!finalChaserSentAt && (
                <Button size="sm" variant="outline" onClick={() => setConfirm("final")} disabled={loading !== null} className="min-h-[44px] border-amber-400 text-amber-900 hover:bg-amber-50 lg:min-h-0">
                  Final offer: half off room hire
                </Button>
              )}
            </div>
          )}
          {(chaserSentAt || finalChaserSentAt) && (
            <p className="text-xs text-muted-foreground">
              {chaserSentAt ? `Chaser sent ${whenSent(chaserSentAt)}.` : ""}
              {chaserSentAt && finalChaserSentAt ? " " : ""}
              {finalChaserSentAt
                ? `Final offer sent ${whenSent(finalChaserSentAt)}${
                    finalChaserDiscountPence
                      ? ` — ${(finalChaserDiscountPence / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" })} off, quote amended`
                      : ""
                  }.`
                : ""}
            </p>
          )}
        </div>
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
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Member discount applied (£, optional)</label>
                <Input
                  type="number" min="0" step="0.01"
                  value={discountPounds}
                  onChange={(e) => setDiscountPounds(e.target.value)}
                  placeholder="0.00"
                />
                <p className="text-xs text-muted-foreground">
                  Check any claimed club child on the booking first; the total above should already
                  include the discount — this records how much of it there was.
                </p>
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
