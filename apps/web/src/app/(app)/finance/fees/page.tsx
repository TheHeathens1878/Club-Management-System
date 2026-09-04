import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFinance } from "@/lib/finance";
import { createClient } from "@/lib/supabase/server";

import { FeesClient, type SystemPlan } from "./fees-client";

export const metadata = { title: "Fees" };

/**
 * The six boxes (Adam, 2026-09-04: "the subs setup is WAY too complicated").
 * Everything the club ordinarily charges, on one page: individual/family
 * membership, individual/family monthly subs, the two card fines. They are a
 * facade over the six system plans — saving here reprices and activates them.
 */
export default async function FinanceFeesPage() {
  await requireFinance();
  const supabase = await createClient();

  const { data: plans } = await supabase
    .from("fee_plans")
    .select("id,system_key,name,amount_pence,active")
    .not("system_key", "is", null)
    .order("sort");

  const rows: SystemPlan[] = (plans ?? [])
    .filter((plan) => plan.system_key !== null)
    .map((plan) => ({
      id: plan.id,
      system_key: plan.system_key as string,
      name: plan.name,
      amount_pence: plan.amount_pence,
      active: plan.active,
    }));

  return (
    <>
      <PageHeader title="Fees" subtitle="What the club charges — six numbers" />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">The club&apos;s fees</CardTitle>
            <p className="text-sm text-muted-foreground">
              Individual or family is worked out automatically from who is playing (two or more
              players under a number is a family). Monthly subs collect on the 1st of each month,
              last payment 1 May; paying up front is the same total in one go. Saving here activates
              the fees.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <FeesClient plans={rows} />
            <p className="mt-4 text-xs text-muted-foreground">
              Need something bespoke — a veterans rate, a social membership?{" "}
              <Link href="/finance/plans" className="underline">
                The full plan builder
              </Link>{" "}
              is still there.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
