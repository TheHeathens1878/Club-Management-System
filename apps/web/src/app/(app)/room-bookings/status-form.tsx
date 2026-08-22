"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmBooking, cancelBooking } from "./actions";

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
      {/* Confirm booking */}
      {currentStatus === "pending" && (
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
                <Button size="sm" onClick={runConfirm} disabled={loading !== null}>
                  {loading === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & notify booker"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirm(null)}>Back</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirm("confirm")} disabled={loading !== null}>
              Confirm booking
            </Button>
          )}
        </>
      )}

      {/* Cancel booking */}
      {(currentStatus === "pending" || currentStatus === "confirmed") && (
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
                >
                  {loading === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send cancellation"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setConfirm(null); setCancelReason(""); }}>
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
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
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
