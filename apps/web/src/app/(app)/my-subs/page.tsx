import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCurrentPersonId, nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

import { PayNowButton } from "./pay-now-button";

/**
 * A member's own subs, and their children's (PLAN.md P4.1).
 *
 * User-scoped client and nothing else: `subscriptions_self_read` already means
 * "mine, the ones I pay for, and my children's", so there is no filtering to
 * write here and no way for this page to show a household that is not the
 * reader's.
 *
 * Two presentations of the same rows: the phone gets the mobile design's My
 * subs artboard — what is owed in one accent card with the pay button under
 * it, then who it is for, then what has been paid — and lg+ keeps the card
 * per subscription it has always had.
 */

function money(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function statusVariant(status: string): "success" | "warning" | "destructive" | "muted" {
  if (status === "active") return "success";
  if (status === "pending") return "warning";
  if (status === "past_due") return "destructive";
  return "muted";
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toLocaleUpperCase("en-GB") ?? "")
      .join("") || "?"
  );
}

export default async function MySubsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const personId = await getCurrentPersonId();
  const supabase = await createClient();

  if (!personId) {
    return (
      <>
        <PageHeader title="My subs" subtitle="Subscriptions for you and your family" />
        <div className="max-w-2xl p-4 lg:p-6">
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Your sign-in is not linked to a member record yet, so there is nothing to show here.
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const { data: subscriptions, error } = await supabase
    .from("subscriptions")
    .select(
      "id,person_id,payer_person_id,status,amount_due_pence,started_at,created_at,subscription_plans(name,description,amount_pence,billing,seasons(name),teams(name))",
    )
    .order("created_at", { ascending: false });

  const subs = subscriptions ?? [];
  const { data: payments } = await supabase
    .from("payments")
    .select("subscription_id,amount_pence,refunded_pence,paid_at")
    .in(
      "subscription_id",
      subs.map((s) => s.id),
    );

  const paidBySub = new Map<string, number>();
  for (const payment of payments ?? []) {
    if (!payment.subscription_id) continue;
    const net = payment.amount_pence - (payment.refunded_pence ?? 0);
    paidBySub.set(payment.subscription_id, (paidBySub.get(payment.subscription_id) ?? 0) + net);
  }

  const names = await resolveNames(subs.map((s) => s.person_id));

  // One derivation, two layouts — so the phone and the desktop can never
  // disagree about what is owed.
  const rows = subs.map((sub) => {
    const plan = sub.subscription_plans;
    const paid = paidBySub.get(sub.id) ?? 0;
    const who = sub.person_id === personId ? "You" : nameOf(names, sub.person_id);
    return {
      sub,
      plan,
      paid,
      who,
      outstanding: Math.max(0, sub.amount_due_pence - paid),
      canPay: sub.status === "pending" && sub.payer_person_id === personId,
      context: [plan?.teams?.name, plan?.seasons?.name].filter(Boolean).join(" · "),
    };
  });

  const owing = rows.filter((row) => row.outstanding > 0);
  const owed = owing.reduce((total, row) => total + row.outstanding, 0);
  const payable = rows.filter((row) => row.canPay && row.outstanding > 0);
  const pastDue = rows.some((row) => row.sub.status === "past_due");

  const rowsById = new Map(rows.map((row) => [row.sub.id, row]));
  const history = (payments ?? [])
    .filter((payment) => payment.subscription_id && payment.paid_at)
    .sort((a, b) => new Date(b.paid_at!).getTime() - new Date(a.paid_at!).getTime());

  const errorBanner = error ? (
    <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {error.message}
    </p>
  ) : null;

  return (
    <>
      <PageHeader title="My subs" subtitle="Subscriptions for you and your family" />

      {/* Phone: the design's My subs artboard. */}
      <div className="space-y-3 p-4 lg:hidden">
        {errorBanner}

        {rows.length === 0 && (
          <div className="rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">
            No subscriptions yet. The club sets these up when a player joins a team.
          </div>
        )}

        {owed > 0 && (
          <div className="rounded-xl border border-accent/30 bg-card p-4">
            <p className="font-display text-[9px] font-medium uppercase tracking-[0.16em] text-primary">
              Due now
            </p>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-3xl font-semibold leading-none tracking-tight">
                {money(owed)}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {owing.length === 1
                  ? `for ${owing[0]!.who.toLowerCase() === "you" ? "you" : owing[0]!.who}`
                  : `across ${owing.length} subscriptions`}
              </span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-normal text-muted-foreground">
              {owing.map((row) => `${row.who} ${money(row.outstanding)}`).join(", ")}
            </p>

            {payable.length > 0 && (
              <div className="mt-3.5 space-y-2">
                {payable.map((row) => (
                  <PayNowButton
                    key={row.sub.id}
                    subscriptionId={row.sub.id}
                    block
                    label={
                      payable.length === 1
                        ? `Pay ${money(row.outstanding)} by card`
                        : `Pay ${money(row.outstanding)} for ${row.who.toLowerCase() === "you" ? "you" : row.who}`
                    }
                  />
                ))}
              </div>
            )}

            <Link
              href="/messages"
              className="mt-3 flex min-h-[44px] items-center justify-center text-[12.5px] text-primary"
            >
              If money is tight, tell the club
            </Link>
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-hidden rounded-xl border bg-card">
            <p className="border-b px-4 py-3 text-[13px] font-semibold">Your subscriptions</p>
            {rows.map((row) => (
              <div
                key={row.sub.id}
                className="flex min-h-[44px] items-center gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
                  {initialsOf(nameOf(names, row.sub.person_id))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold leading-tight">{row.who}</span>
                  <span className="mt-1 block text-[11.5px] leading-tight text-muted-foreground">
                    {[row.plan?.name ?? "Subscription", row.context].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {row.outstanding > 0 ? (
                  <Badge variant="warning" className="flex-none">
                    {money(row.outstanding)} due
                  </Badge>
                ) : (
                  <Badge variant={statusVariant(row.sub.status)} className="flex-none">
                    {row.sub.status.replace("_", " ")}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}

        {history.length > 0 && (
          <div className="overflow-hidden rounded-xl border bg-card">
            <p className="border-b px-4 py-3 text-[13px] font-semibold">What you have paid</p>
            {history.map((payment, index) => {
              const row = rowsById.get(payment.subscription_id!);
              const net = payment.amount_pence - (payment.refunded_pence ?? 0);
              return (
                <div
                  key={`${payment.subscription_id}-${payment.paid_at}-${index}`}
                  className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0 text-[13px]"
                >
                  <span className="min-w-0">
                    <span className="block">{row?.plan?.name ?? "Subscription"}</span>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      {formatDate(payment.paid_at)}
                      {row && row.who !== "You" ? ` · ${row.who}` : ""}
                      {(payment.refunded_pence ?? 0) > 0
                        ? ` · ${money(payment.refunded_pence ?? 0)} refunded`
                        : ""}
                    </span>
                  </span>
                  <span className="flex-none font-semibold">{money(net)}</span>
                </div>
              );
            })}
          </div>
        )}

        {pastDue && (
          <p className="px-0.5 text-[12px] leading-normal text-muted-foreground">
            A payment did not go through. The club will be in touch, or you can pay at the bar.
          </p>
        )}

        {rows.length > 0 && (
          <p className="px-0.5 text-[12px] leading-normal text-muted-foreground">
            Nobody is stopped from playing over subs.
          </p>
        )}
      </div>

      {/* lg+: a card per subscription, as the desk has always shown it. */}
      <div className="hidden max-w-3xl space-y-4 p-6 lg:block">
        {errorBanner}

        {rows.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No subscriptions yet. The club sets these up when a player joins a team.
            </CardContent>
          </Card>
        )}

        {rows.map((row) => (
          <Card key={row.sub.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{row.plan?.name ?? "Subscription"}</CardTitle>
                <Badge variant={statusVariant(row.sub.status)}>
                  {row.sub.status.replace("_", " ")}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {[row.who, row.context].filter(Boolean).join(" · ")}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                {money(row.paid)} paid of {money(row.sub.amount_due_pence)}
                {row.outstanding > 0 && (
                  <span className="font-medium"> · {money(row.outstanding)} outstanding</span>
                )}
              </p>
              {row.canPay && <PayNowButton subscriptionId={row.sub.id} />}
              {row.sub.status === "past_due" && (
                <p className="text-xs text-muted-foreground">
                  Payment did not go through. The club will be in touch, or you can pay at the bar.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
