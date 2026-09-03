"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { payBookingMock, createCheckoutForBooking, finalizeCheckout } from "./actions";

type WidgetGlobal = { SumUpCard?: { mount: (o: Record<string, unknown>) => void } };

function loadSumUpSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as unknown as WidgetGlobal).SumUpCard) return resolve();
    const existing = document.getElementById("sumup-sdk") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load SumUp")));
      return;
    }
    const s = document.createElement("script");
    s.id = "sumup-sdk";
    s.src = "https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load SumUp"));
    document.body.appendChild(s);
  });
}

export function PayButton({
  bookingId,
  amountPence,
  label,
  variant = "default",
  sumupEnabled,
  purpose,
}: {
  bookingId: string;
  amountPence: number;
  label: string;
  variant?: "default" | "outline";
  sumupEnabled: boolean;
  purpose: "deposit" | "balance";
}) {
  const router = useRouter();
  const reactId = useId();
  const containerId = `sumup-${reactId.replace(/[:]/g, "")}`;
  const [stage, setStage] = useState<"idle" | "loading" | "widget">("idle");
  const [error, setError] = useState<string | null>(null);
  // The deposit terms tick (Adam, 2026-09-03, reinstated): paying the deposit
  // is what accepts them, so the tick comes first and the moment is stamped
  // on the booking by the checkout action.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function startSumUp() {
    setError(null);
    if (purpose === "deposit" && !termsAccepted) {
      setError("Please tick to accept the deposit terms first.");
      return;
    }
    // SumUp's UK minimum card transaction is £1.00.
    if (amountPence < 100) {
      setError("Card payments must be at least £1.00. Please contact the club to pay a smaller amount.");
      return;
    }
    setStage("loading");
    const res = await createCheckoutForBooking(bookingId, amountPence, purpose, termsAccepted);
    if (res.error || !res.checkoutId) {
      setError(res.error ?? "Could not start payment.");
      setStage("idle");
      return;
    }
    const checkoutId = res.checkoutId;
    try {
      await loadSumUpSdk();
    } catch {
      setError("Could not load the payment form. Please try again.");
      setStage("idle");
      return;
    }
    setStage("widget");
    // Mount once the container has rendered
    setTimeout(() => {
      (window as unknown as WidgetGlobal).SumUpCard?.mount({
        id: containerId,
        checkoutId,
        showSubmitButton: true,
        onResponse: (type: string, body: unknown) => {
          const paid =
            type === "success" ||
            (typeof body === "object" && body !== null && (body as { status?: string }).status === "PAID");
          if (paid) {
            startTransition(async () => {
              const f = await finalizeCheckout(checkoutId, bookingId);
              if (f.error) setError(f.error);
              else {
                setStage("idle");
                router.refresh();
              }
            });
          } else if (type === "error") {
            setError("Payment was not completed.");
          }
        },
      });
    }, 50);
  }

  function startMock() {
    if (!confirm(`Pay ${formatCurrency(amountPence)} now?`)) return;
    setError(null);
    startTransition(async () => {
      const r = await payBookingMock(bookingId, amountPence);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }

  // The deposit terms tick — shown with the idle button; paying the deposit
  // is what accepts them, so the tick gates the start of the checkout.
  const termsTick =
    purpose === "deposit" ? (
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={(e) => { setTermsAccepted(e.target.checked); setError(null); }}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          I accept the deposit terms: the deposit secures the booking and is refundable only as
          set out in the club&apos;s booking terms.
        </span>
      </label>
    ) : null;

  if (stage === "widget") {
    return (
      <div className="w-full space-y-2 rounded-md border bg-muted/20 p-3">
        <p className="text-sm font-medium">Pay {formatCurrency(amountPence)}</p>
        <div id={containerId} />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => setStage("idle")}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {termsTick}
      <Button
        size="sm"
        variant={variant}
        disabled={isPending || stage === "loading" || (purpose === "deposit" && !termsAccepted)}
        onClick={sumupEnabled ? startSumUp : startMock}
      >
        {stage === "loading" ? "Starting…" : isPending ? "Processing…" : `${label} (${formatCurrency(amountPence)})`}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
