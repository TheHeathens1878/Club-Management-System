"use client";

/**
 * The 18th-birthday security deposit's return, recorded (Adam, 2026-09-03:
 * the room-desk audit — the columns survived the cutover, the workflow did
 * not). Recording it here is also what stops the day-after staff nudge.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";

import { markSecurityDepositReturned } from "./actions";

export function SecurityDepositCard({
  bookingId,
  amountPence,
  returnedAt,
  returnedMethod,
  returnedNote,
}: {
  bookingId: string;
  amountPence: number;
  returnedAt: string | null;
  returnedMethod: string | null;
  returnedNote: string | null;
}) {
  const router = useRouter();
  const [method, setMethod] = useState("bank transfer");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (returnedAt) {
    return (
      <div className="space-y-1 text-sm">
        <p>
          <span className="font-medium">{formatCurrency(amountPence)}</span> returned on{" "}
          {new Date(returnedAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
          {returnedMethod ? ` by ${returnedMethod}` : ""}.
        </p>
        {returnedNote ? <p className="text-xs text-muted-foreground">{returnedNote}</p> : null}
      </div>
    );
  }

  async function run() {
    setError(null);
    setSaving(true);
    const result = await markSecurityDepositReturned(bookingId, { method, note: note || null });
    setSaving(false);
    if (result.error) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        A refundable <span className="font-medium text-foreground">{formatCurrency(amountPence)}</span>{" "}
        security deposit applies (18th birthday). Record its return here once it has gone back.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Returned by
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="block h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="bank transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="card refund">Card refund</option>
          </select>
        </label>
        <label className="flex-1 space-y-1 text-xs text-muted-foreground">
          Note (optional)
          <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-9" />
        </label>
        <Button type="button" size="sm" onClick={() => void run()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark returned"}
        </Button>
      </div>
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}
