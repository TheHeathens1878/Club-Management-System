import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFinance } from "@/lib/finance";
import { createClient } from "@/lib/supabase/server";

import { PlansClient, type FeePlanRow } from "./plans-client";

export const metadata = { title: "Plans" };

/**
 * The catalogue: bespoke membership options per cohort, subs, one-off fines.
 * The six minimum plans are seeded inactive with placeholder prices — the
 * treasurer sets the real fee and activates.
 */
export default async function FinancePlansPage() {
  await requireFinance();
  const supabase = await createClient();

  const { data: plans } = await supabase
    .from("fee_plans")
    .select("id,name,description,cohort,kind,scope,amount_pence,schedule,months_total,active,sort")
    .order("sort")
    .order("name");

  const rows: FeePlanRow[] = (plans ?? []).map((plan) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    cohort: plan.cohort,
    kind: plan.kind,
    scope: plan.scope,
    amount_pence: plan.amount_pence,
    schedule: plan.schedule,
    months_total: plan.months_total,
    active: plan.active,
  }));

  return (
    <>
      <PageHeader title="Plans" subtitle="Everything the club can charge for" />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Fee plans</CardTitle>
            <p className="text-sm text-muted-foreground">
              A plan is a price with a name: membership fees (individual/family), monthly or
              up-front subs, yellow and red card fines, anything bespoke for a cohort. Inactive
              plans never charge anybody.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <PlansClient plans={rows} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
