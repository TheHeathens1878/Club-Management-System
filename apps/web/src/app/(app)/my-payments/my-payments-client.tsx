"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

import {
  createCheckoutForCharge,
  finalizeChargeCheckout,
  revokeMyMandate,
  startMyEnrolment,
} from "./actions";

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

export type MyCharge = {
  id: string;
  charge_no: number;
  kind: string;
  description: string;
  amount_pence: number;
  due_on: string;
  status: string;
  for_name: string | null;
  payments: { id: string; amount_pence: number; refunded_pence: number; paid_at: string | null; method: string | null }[];
};

export type MyAgreement = {
  id: string;
  plan_name: string;
  amount_pence: number;
  schedule: string;
  next_charge_on: string | null;
  months_total: number | null;
  months_charged: number;
};

export type MyMandate = { id: string; status: string; card: string | null; covers_fines: boolean };

export type MyQuote = {
  scope: string;
  season_name: string;
  membership_pence: number;
  monthly_pence: number;
  instalments: number;
  first_on: string | null;
  last_on: string | null;
  total_pence: number;
};

function money(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "To pay",
  paid: "Paid",
  waived: "Waived",
  void: "Void",
};

export function MyPaymentsClient({
  accountId,
  charges,
  agreements,
  mandate,
  quote,
  quoteNote,
  isLead,
  sumupEnabled,
}: {
  accountId: string;
  charges: MyCharge[];
  agreements: MyAgreement[];
  mandate: MyMandate | null;
  quote: MyQuote | null;
  quoteNote: string | null;
  isLead: boolean;
  sumupEnabled: boolean;
}) {
  const router = useRouter();
  const reactId = useId();
  const containerId = `sumup-${reactId.replace(/[:]/g, "")}`;
  const [paying, setPaying] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "loading" | "widget">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // REAL TIME: the moment a payment or charge lands on this account —
  // recorded at the bar, collected by the club, paid from another phone —
  // the page refreshes itself. RLS decides what this browser may hear.
  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 400);
    };
    const channel = supabase
      .channel(`my-payments:${accountId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, refresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "charges", filter: `account_id=eq.${accountId}` },
        refresh,
      )
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [accountId, router]);

  async function startPayment(charge: MyCharge) {
    setError(null);
    setPaying(charge.id);
    setStage("loading");
    const res = await createCheckoutForCharge(charge.id, true, true);
    if (res.error || !res.checkoutId) {
      setError(res.error ?? "Could not start payment.");
      setPaying(null);
      setStage("idle");
      return;
    }
    const checkoutId = res.checkoutId;
    try {
      await loadSumUpSdk();
    } catch {
      setError("Could not load the payment form. Please try again.");
      setPaying(null);
      setStage("idle");
      return;
    }
    setStage("widget");
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
              const f = await finalizeChargeCheckout(checkoutId);
              if (f.error) setError(f.error);
              setStage("idle");
              setPaying(null);
              router.refresh();
            });
          } else if (type === "error") {
            setError("Payment was not completed.");
          }
        },
      });
    }, 50);
  }

  const outstanding = charges.filter((c) => c.status === "pending");
  const totalOwing = outstanding.reduce((acc, charge) => {
    const paid = charge.payments.reduce((a, p) => a + p.amount_pence - p.refunded_pence, 0);
    return acc + Math.max(0, charge.amount_pence - paid);
  }, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 lg:p-6">
          <CardTitle className="text-base">
            {totalOwing > 0 ? `To pay: ${money(totalOwing)}` : "Nothing to pay — you're up to date"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Payments show here the moment they are recorded — including cash paid at the club.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0 lg:p-6 lg:pt-0">
          {charges.length === 0 && <p className="text-sm text-muted-foreground">No charges yet.</p>}
          {charges.map((charge) => {
            const paid = charge.payments.reduce((a, p) => a + p.amount_pence - p.refunded_pence, 0);
            const owing = Math.max(0, charge.amount_pence - paid);
            return (
              <div key={charge.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{charge.description}</span>
                      <Badge variant={charge.status === "paid" ? "success" : charge.status === "pending" ? "destructive" : "muted"}>
                        {STATUS_LABELS[charge.status] ?? charge.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {charge.for_name ? `For ${charge.for_name} · ` : ""}due {charge.due_on}
                      {paid > 0 && charge.status === "pending" ? ` · ${money(paid)} already paid` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums">{money(charge.status === "pending" ? owing : charge.amount_pence)}</span>
                    {charge.status === "pending" && owing >= 100 && sumupEnabled && (
                      <button
                        type="button"
                        disabled={stage !== "idle" || isPending}
                        onClick={() => startPayment(charge)}
                        className="min-h-[40px] rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {paying === charge.id && stage === "loading" ? "Starting…" : "Pay now"}
                      </button>
                    )}
                  </div>
                </div>
                {charge.payments.length > 0 && (
                  <ul className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
                    {charge.payments.map((payment) => (
                      <li key={payment.id} className="flex justify-between">
                        <span>
                          {payment.paid_at ? new Date(payment.paid_at).toLocaleDateString("en-GB") : "—"} · {payment.method ?? "payment"}
                          {payment.refunded_pence > 0 ? ` · ${money(payment.refunded_pence)} refunded` : ""}
                        </span>
                        <span className="tabular-nums">{money(payment.amount_pence)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {paying === charge.id && stage === "widget" && (
                  <div className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3">
                    <div id={containerId} />
                    <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setStage("idle"); setPaying(null); }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {sumupEnabled && totalOwing >= 100 && stage === "idle" && (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Paying online keeps your card on file: monthly subs and any club charges (including
              match fines) are collected from it automatically, with an email each time. You can
              remove the card below at any time.
            </p>
          )}
        </CardContent>
      </Card>

      {quoteNote && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground lg:p-6">
            {quoteNote.includes("Finance → Fees") ? (
              <>
                {quoteNote.replace(" Save & activate them in Finance → Fees.", "")}{" "}
                <a href="/finance/fees" className="font-medium underline">
                  Save &amp; activate them in Finance → Fees.
                </a>
              </>
            ) : (
              quoteNote
            )}
          </CardContent>
        </Card>
      )}

      {isLead && quote && (
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Set up your {quote.season_name} membership</CardTitle>
            <p className="text-sm text-muted-foreground">
              Your household counts as <span className="font-medium">{quote.scope}</span> (worked
              out from who is playing).
            </p>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0 lg:p-6 lg:pt-0">
            <div className="rounded-lg border p-3 text-sm">
              <p>
                {money(quote.membership_pence)} membership
                {quote.instalments > 0
                  ? ` + ${money(quote.monthly_pence)} a month × ${quote.instalments} (1st of each month${quote.last_on ? `, last payment ${new Date(quote.last_on).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}` : ""})`
                  : " — no subs instalments remain this season"}
              </p>
              <p className="mt-1 text-base font-semibold tabular-nums">Total {money(quote.total_pence)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await startMyEnrolment("monthly");
                    if (res.error) setError(res.error);
                    else router.refresh();
                  })
                }
                className="min-h-[44px] rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Pay monthly
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await startMyEnrolment("upfront");
                    if (res.error) setError(res.error);
                    else router.refresh();
                  })
                }
                className="min-h-[44px] rounded-md border px-4 text-sm font-medium hover:bg-secondary disabled:opacity-50"
              >
                Pay {money(quote.total_pence)} up front
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Both come to the same total. Choosing puts the membership fee on your account to pay
              now{quote.instalments > 0 ? "; monthly subs then collect on the 1st of each month" : ""}.
            </p>
          </CardContent>
        </Card>
      )}

      {(agreements.length > 0 || mandate) && (
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Membership & subs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0 lg:p-6 lg:pt-0">
            {agreements.map((agreement) => (
              <div key={agreement.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{agreement.plan_name}</p>
                <p className="text-xs text-muted-foreground">
                  {money(agreement.amount_pence)} {agreement.schedule === "monthly" ? "a month" : "a year"}
                  {agreement.months_total ? ` · ${agreement.months_charged}/${agreement.months_total} collected` : ""}
                  {agreement.next_charge_on ? ` · next collection ${agreement.next_charge_on}` : ""}
                </p>
              </div>
            ))}

            {mandate && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <span>
                  Card on file: <span className="font-medium">{mandate.card ?? "being set up"}</span>
                  {mandate.covers_fines && <Badge variant="outline" className="ml-2">covers one-off fines</Badge>}
                </span>
                {isLead && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await revokeMyMandate();
                        if (res.error) setError(res.error);
                        else router.refresh();
                      })
                    }
                    className="text-xs text-muted-foreground underline hover:text-destructive"
                  >
                    Remove card
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
