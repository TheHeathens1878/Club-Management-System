import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import {
  ArrearsPanel,
  PlansPanel,
  type ArrearsRow,
  type Option,
  type PlanRow,
} from "./subs-client";

/**
 * Subs and arrears for the club (PLAN.md P4.1, P4.2).
 *
 * User-scoped client. `subscription_arrears` is a `security_invoker` view, so
 * it shows a coach their own teams and an administrator everything — reading
 * it with the service key would have shown everyone everything and quietly
 * turned a per-team view into a club-wide one.
 */
export default async function SubsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/my-subs");

  const supabase = await createClient();
  const [{ data: planRows }, { data: arrearsRows, error: arrearsError }, { data: seasons }, { data: teams }] =
    await Promise.all([
      supabase
        .from("subscription_plans")
        .select("id,name,description,amount_pence,billing,instalments,active,seasons(name),teams(name)")
        .order("created_at", { ascending: false }),
      supabase
        .from("subscription_arrears")
        .select("*")
        .order("outstanding_pence", { ascending: false }),
      supabase.from("seasons").select("id,name").order("starts_on", { ascending: false }),
      supabase.from("teams").select("id,name").eq("active", true).order("name"),
    ]);

  const plans: PlanRow[] = (planRows ?? []).map((plan) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    amount_pence: plan.amount_pence,
    billing: plan.billing,
    instalments: plan.instalments,
    active: plan.active,
    season_name: plan.seasons?.name ?? "—",
    team_name: plan.teams?.name ?? null,
  }));

  const arrears: ArrearsRow[] = (arrearsRows ?? [])
    .filter((row) => row.subscription_id !== null)
    .map((row) => ({
      subscription_id: row.subscription_id as string,
      person_name: row.person_name,
      plan_name: row.plan_name ?? "—",
      team_name: row.team_name,
      status: row.status ?? "—",
      amount_due_pence: row.amount_due_pence ?? 0,
      paid_pence: row.paid_pence ?? 0,
      outstanding_pence: row.outstanding_pence ?? 0,
      days_since_start: row.days_since_start ?? 0,
    }));

  const seasonOptions: Option[] = seasons ?? [];
  const teamOptions: Option[] = teams ?? [];

  return (
    <>
      <PageHeader title="Subs" subtitle="Plans, subscriptions and what is outstanding" />

      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Plans</CardTitle>
            <p className="text-sm text-muted-foreground">
              What the club charges for a season, club-wide or per team. Stripe products and prices
              are created on the fly when the first member pays.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <PlansPanel plans={plans} seasons={seasonOptions} teams={teamOptions} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Arrears</CardTitle>
            <p className="text-sm text-muted-foreground">
              Live subscriptions with what has been paid netted off, refunds included. Payments
              taken in cash or by transfer go in here and land in the same ledger as Stripe&apos;s.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            {arrearsError && (
              <p className="mb-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {arrearsError.message}
              </p>
            )}
            <ArrearsPanel rows={arrears} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
