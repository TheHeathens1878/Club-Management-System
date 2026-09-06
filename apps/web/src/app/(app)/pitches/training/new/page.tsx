import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { NewBlockForm } from "./new-block-form";

export const metadata = { title: "New training block" };

export const dynamic = "force-dynamic";

/**
 * `/pitches/training/new` — four fields and a button. The season is
 * suggested from the current one so the name and the dates come pre-filled
 * with something sensible; the slots and the teams are added on the block's
 * page once it exists.
 */
export default async function NewTrainingBlockPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/lobby");

  const supabase = await createClient();
  const { data: season } = await supabase
    .from("seasons")
    .select("id,name,starts_on,ends_on")
    .eq("is_current", true)
    .maybeSingle();

  // Winter, roughly: the November after the season starts to the March
  // before it ends. Just a starting value.
  const year = season ? Number.parseInt(season.starts_on.slice(0, 4), 10) : new Date().getFullYear();
  const defaults = {
    name: season ? `Winter ${season.name}` : `Winter ${year}/${String(year + 1).slice(2)}`,
    startsOn: `${year}-11-02`,
    endsOn: `${year + 1}-03-27`,
    seasonId: season?.id ?? null,
  };

  return (
    <>
      <PageHeader
        title="New training block"
        subtitle="Name it and give it its first and last days — the venues and the teams come next"
        back={{ href: "/pitches/training", label: "Training blocks" }}
      />
      <div className="p-4 lg:p-6">
        <Card className="max-w-2xl">
          <CardContent className="p-4 lg:p-6">
            <NewBlockForm defaults={defaults} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
