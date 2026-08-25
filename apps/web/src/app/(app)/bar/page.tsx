import { redirect } from "next/navigation";
import { getSessionProfile, isBarManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NonUserStaffClient } from "./non-user-staff-client";
import { FaqsClient } from "@/app/(app)/settings/faqs-client";

export default async function BarPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isBarManager(session.profile?.role)) redirect("/lobby");

  const admin = createAdminClient();
  const [{ data: nonUserStaff }, { data: faqs }] = await Promise.all([
    admin.from("non_user_staff").select("id,name").order("name"),
    admin.from("faqs").select("*").order("sort_order"),
  ]);

  return (
    <>
      <PageHeader title="Bar" subtitle="Manage external staff and FAQs" />

      <div className="p-4 space-y-4 max-w-2xl lg:p-6 lg:space-y-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle>External / non-system staff</CardTitle>
            <p className="text-sm text-muted-foreground">
              Staff members without a system account, for tracking availability.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <NonUserStaffClient initial={nonUserStaff ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle>FAQs</CardTitle>
            <p className="text-sm text-muted-foreground">
              These appear on the public booking page.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <FaqsClient faqs={faqs ?? []} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
