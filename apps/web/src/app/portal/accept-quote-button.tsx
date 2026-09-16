"use client";

/**
 * "Accept this quote" — the booker's Confirm (2026-09-13). A tick for the
 * terms, one button, and the booking is confirmed subject to the deposit;
 * the page refreshes into the confirmed state with the deposit button ready.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

import { acceptQuote } from "./actions";

export function AcceptQuoteButton({ bookingId, totalPence }: { bookingId: string; totalPence: number }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function go() {
    setError(null);
    if (!accepted) {
      setError("Please tick to accept the booking terms first.");
      return;
    }
    startTransition(async () => {
      const result = await acceptQuote(bookingId, accepted);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => {
            setAccepted(event.target.checked);
            setError(null);
          }}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          I accept the booking terms: a <strong>non-refundable</strong> deposit secures the room and is paid first;
          the balance, plus any refundable security deposit, is due at least two weeks before the event.
        </span>
      </label>
      <Button type="button" size="touch" onClick={go} disabled={pending || !accepted}>
        {pending ? "Confirming…" : `Accept the quote and book (${formatCurrency(totalPence)})`}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
