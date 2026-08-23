import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, KeyRound } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { isClubAdmin, nameOf, resolveNames } from "@/lib/person";
import { formatStamp } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";
import { ageGroupSortKey } from "@/lib/waiting-list";

import { GrantForm, RevokeForm } from "./access-forms";

/**
 * Waiting list access (gap 10) — who, besides a club administrator, may read
 * the children waiting for a place.
 *
 * A club administrator's screen. The grant is a row in
 * `waiting_list_access`; `wl_entries_coach_read` is what turns it into
 * visibility, and there is no other way to see an entry. Revoking is a delete,
 * which is why the table has a DELETE grant and the entries table does not.
 *
 * These are children's records — name, date of birth, school, health
 * conditions — so the list of who holds access is shown in full and the page
 * says out loud what a grant means.
 */

export const dynamic = "force-dynamic";

export default async function WaitingListAccessPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!(await isClubAdmin())) redirect("/waiting-list/manage");

  const supabase = await createClient();
  const [{ data: grantRows, error }, { data: groupRows }] = await Promise.all([
    supabase
      .from("waiting_list_access")
      .select("person_id, age_group, created_at, granted_by")
      .order("age_group"),
    supabase.from("waiting_list_age_groups").select("age_group, is_open"),
  ]);

  const grants = grantRows ?? [];
  const ageGroups = (groupRows ?? [])
    .map((row) => row.age_group)
    .sort((a, b) => ageGroupSortKey(a).localeCompare(ageGroupSortKey(b)));
  const openGroups = new Set(
    (groupRows ?? []).filter((row) => row.is_open).map((row) => row.age_group),
  );

  const names = await resolveNames(grants.map((grant) => grant.person_id));

  const byPerson = new Map<string, typeof grants>();
  for (const grant of grants) {
    const list = byPerson.get(grant.person_id);
    if (list) list.push(grant);
    else byPerson.set(grant.person_id, [grant]);
  }
  const people = Array.from(byPerson.entries()).sort(([a], [b]) =>
    nameOf(names, a).localeCompare(nameOf(names, b)),
  );

  return (
    <>
      <PageHeader
        title="Waiting list access"
        subtitle="Coaches who can see the children waiting for a place, age group by age group"
        action={
          <Link
            href="/waiting-list/manage"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ChevronLeft className="h-4 w-4" /> Back to the desk
          </Link>
        }
      />

      <div className="max-w-3xl space-y-6 p-6">
        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" /> Grant access
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              A grant lets that person read every waiting list entry in that age group — the
              child&apos;s name, date of birth, school, any health conditions the parent gave, and
              the parent&apos;s contact details — and add notes to them. Grant only what a coach
              needs for the group they run. They are told in the app as soon as you do.
            </p>
          </CardHeader>
          <CardContent>
            <GrantForm ageGroups={ageGroups} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current access</CardTitle>
            <p className="text-sm text-muted-foreground">
              Club administrators are not listed here — they reach the whole list through their
              role, not through a grant.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {people.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nobody outside the club administrators can see the waiting list.
              </p>
            )}

            {people.map(([personId, personGrants]) => (
              <div key={personId} className="rounded-lg border bg-card px-4 py-3">
                <p className="text-sm font-medium">{nameOf(names, personId)}</p>
                <ul className="mt-2 space-y-1.5">
                  {personGrants
                    .slice()
                    .sort((a, b) =>
                      ageGroupSortKey(a.age_group).localeCompare(ageGroupSortKey(b.age_group)),
                    )
                    .map((grant) => (
                      <li
                        key={`${grant.person_id}:${grant.age_group}`}
                        className="flex flex-wrap items-center gap-2 text-sm"
                      >
                        <Badge variant="outline">{grant.age_group}</Badge>
                        {!openGroups.has(grant.age_group) && (
                          <Badge variant="muted">Group closed</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          since {formatStamp(grant.created_at)}
                        </span>
                        <span className="ml-auto">
                          <RevokeForm personId={grant.person_id} ageGroup={grant.age_group} />
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
