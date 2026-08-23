import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCurrentPersonId, nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { PayNowButton } from "./pay-now-button";

/**
 * A member's own subs, and their children's (PLAN.md P4.1).
 *
 * User-scoped client and nothing else: `subscriptions_self_read` already means
 * "mine, the ones I pay for, and my children's", so there is no filtering to
 * write here and no way for this page to show a household that is not the
 * reader's.
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

export default async function MySubsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const personId = await getCurrentPersonId();
  const supabase = await createClient();

  if (!personId) {
    return (
      <>
        <PageHeader title="My subs" subtitle="Subscriptions for you and your family" />
        <div className="p-6 max-w-2xl">
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

  return (
    <>
      <PageHeader title="My subs" subtitle="Subscriptions for you and your family" />

      <div className="p-6 space-y-4 max-w-3xl">
        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error.message}
          </p>
        )}

        {subs.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No subscriptions yet. The club sets these up when a player joins a team.
            </CardContent>
          </Card>
        )}

        {subs.map((sub) => {
          const plan = sub.subscription_plans;
          const paid = paidBySub.get(sub.id) ?? 0;
          const outstanding = Math.max(0, sub.amount_due_pence - paid);
          const canPay = sub.status === "pending" && sub.payer_person_id === personId;

          return (
            <Card key={sub.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{plan?.name ?? "Subscription"}</CardTitle>
                  <Badge variant={statusVariant(sub.status)}>{sub.status.replace("_", " ")}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {sub.person_id === personId ? "You" : nameOf(names, sub.person_id)}
                  {plan?.teams?.name ? ` · ${plan.teams.name}` : ""}
                  {plan?.seasons?.name ? ` · ${plan.seasons.name}` : ""}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">
                  {money(paid)} paid of {money(sub.amount_due_pence)}
                  {outstanding > 0 && (
                    <span className="font-medium"> · {money(outstanding)} outstanding</span>
                  )}
                </p>
                {canPay && <PayNowButton subscriptionId={sub.id} />}
                {sub.status === "past_due" && (
                  <p className="text-xs text-muted-foreground">
                    Payment did not go through. The club will be in touch, or you can pay at the bar.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
