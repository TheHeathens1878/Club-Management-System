import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { ReportForm, type PersonOption } from "./report-form";

export const metadata = { title: "Report a safeguarding concern" };

/** Any signed-in user may report (SG-3) and may see their own receipts (D3). */
export default async function ReportConcernPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const [{ data: peopleRows }, { data: receipts, error: receiptsError }] = await Promise.all([
    supabase.from("people").select("id,first_name,last_name,preferred_name").order("last_name").limit(300),
    supabase.rpc("my_concern_receipts"),
  ]);

  const people: PersonOption[] = (peopleRows ?? []).map((p) => ({
    id: p.id,
    name: `${p.preferred_name || p.first_name} ${p.last_name}`.trim(),
  }));

  return (
    <>
      <PageHeader title="Report a safeguarding concern" subtitle="Goes straight to the club's safeguarding lead" />

      <div className="max-w-2xl space-y-6 p-4 lg:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tell the safeguarding lead</CardTitle>
            <p className="text-sm text-muted-foreground">
              If a child is in immediate danger, call 999 first. Reports here are read by the club&apos;s
              safeguarding lead only. You will get a reference back; you will not be able to read the
              case itself, and neither can anyone the report names.
            </p>
          </CardHeader>
          <CardContent>
            <ReportForm people={people} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">My reports</CardTitle>
            <p className="text-sm text-muted-foreground">
              What you reported, and where it has got to.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {receiptsError && (
              <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {receiptsError.message}
              </p>
            )}
            {(receipts ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">You have not reported anything.</p>
            )}
            {(receipts ?? []).map((receipt) => (
              <div key={receipt.ref} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium">{receipt.ref}</span>
                  <Badge variant={receipt.status === "closed" ? "muted" : "default"}>
                    {receipt.status.replace("_", " ")}
                  </Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{receipt.narrative}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
