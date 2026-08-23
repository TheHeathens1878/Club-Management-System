import Link from "next/link";

import type { Database } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  STATUS_LABELS,
  formatStamp,
  roleLabel,
  statusVariant,
} from "@/lib/account-requests";
import { getCurrentPersonId, resolveNames } from "@/lib/person";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { qualifiesForView, type RoleView } from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";

import { RoleTiles, type AdminContact, type TeamOption } from "./role-tiles";
import { WithdrawForm } from "./withdraw-form";

/**
 * "Which hat are you wearing?" — the first-login role tiles (gap 4), and the
 * page the nav's "My role" link comes back to.
 *
 * User-scoped client throughout. Choosing a tile changes the nav grouping and
 * nothing else; asking for a role writes an `account_requests` row, which a
 * club administrator then approves or rejects. The list of club administrators
 * is a plain `person_roles` read: RLS answers it for an administrator and
 * returns nothing to anyone else, and the empty case is a real answer, not a
 * failure — the tile says so in general terms instead of naming anyone.
 */

export const dynamic = "force-dynamic";

type RequestRow = Pick<
  Database["public"]["Tables"]["account_requests"]["Row"],
  | "id"
  | "requested_role"
  | "team_id"
  | "message"
  | "status"
  | "decision_note"
  | "created_at"
  | "decided_at"
>;

function HoldBadge({ label, held }: { label: string; held: boolean }) {
  return held ? (
    <Badge variant="success">{label}</Badge>
  ) : (
    <Badge variant="muted">{label}</Badge>
  );
}

export default async function WelcomePage() {
  const supabase = await createClient();
  const [capabilities, storedView, personId] = await Promise.all([
    getCapabilities(),
    getStoredRoleView(),
    getCurrentPersonId(),
  ]);

  const [{ data: teamRows }, { data: adminRoleRows }] = await Promise.all([
    supabase.from("teams").select("id,name,age_group").eq("active", true).order("sort_order").order("name"),
    supabase.from("person_roles").select("person_id").eq("role", "club_admin").is("revoked_at", null),
  ]);

  let requests: RequestRow[] = [];
  if (personId) {
    const { data } = await supabase
      .from("account_requests")
      .select("id,requested_role,team_id,message,status,decision_note,created_at,decided_at")
      .eq("person_id", personId)
      .order("created_at", { ascending: false });
    requests = data ?? [];
  }

  const teams: TeamOption[] = (teamRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    ageGroup: t.age_group,
  }));
  const teamNames = new Map(teams.map((t) => [t.id, t.name]));

  const adminIds = Array.from(new Set((adminRoleRows ?? []).map((r) => r.person_id)));
  const adminNames = await resolveNames(adminIds);
  const { data: adminPeople } = adminIds.length
    ? await supabase.from("people").select("id,email").in("id", adminIds)
    : { data: [] as { id: string; email: string | null }[] };
  const adminEmails = new Map((adminPeople ?? []).map((p) => [p.id, p.email]));
  const admins: AdminContact[] = adminIds.map((id) => ({
    id,
    name: adminNames.get(id) ?? "Club administrator",
    email: adminEmails.get(id) ?? null,
  }));

  const views: RoleView[] = ["player", "parent", "coach", "admin"];
  const qualified = views.filter((v) => qualifiesForView(v, capabilities));

  return (
    <div>
      <PageHeader
        title="Your role at the club"
        subtitle="Pick the one that fits best. It shapes the menu — it does not grant anything on its own."
      />

      <div className="space-y-6 p-8">
        <RoleTiles teams={teams} initialView={storedView} admins={admins} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What your account holds today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <HoldBadge label="Player" held={capabilities.hasPlayerMembership} />
              <HoldBadge label="Parent or guardian" held={capabilities.isGuardian || capabilities.hasParentRole} />
              <HoldBadge label="Team staff" held={capabilities.isTeamStaff || capabilities.hasCoachRole} />
              <HoldBadge label="Club admin" held={capabilities.isClubAdmin || capabilities.isCommittee} />
              {capabilities.isSafeguardingLead ? <Badge variant="success">Safeguarding lead</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {qualified.length === 0
                ? "Nothing yet — ask for what fits above and a club administrator will look at it."
                : "A view you do not hold is still yours to look at; the menu will only ever show what your account can actually reach."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">You have not asked for anything yet.</p>
            ) : (
              <ul className="space-y-3">
                {requests.map((request) => (
                  <li key={request.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {roleLabel(request.requested_role)}
                          {request.team_id ? (
                            <span className="text-muted-foreground">
                              {" · "}
                              {teamNames.get(request.team_id) ?? "Team"}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Asked {formatStamp(request.created_at)}
                          {request.decided_at ? ` · decided ${formatStamp(request.decided_at)}` : ""}
                        </p>
                      </div>
                      <Badge variant={statusVariant(request.status)}>
                        {STATUS_LABELS[request.status]}
                      </Badge>
                    </div>

                    {request.message ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        &ldquo;{request.message}&rdquo;
                      </p>
                    ) : null}

                    {request.decision_note ? (
                      <p
                        className={
                          "mt-2 whitespace-pre-wrap rounded-md p-3 text-sm " +
                          (request.status === "pending"
                            ? "bg-amber-50 text-amber-800"
                            : "bg-muted text-muted-foreground")
                        }
                      >
                        {request.status === "pending" ? (
                          <span className="font-medium">On hold: </span>
                        ) : null}
                        {request.decision_note}
                      </p>
                    ) : null}

                    {request.status === "pending" ? (
                      <div className="mt-3">
                        <WithdrawForm requestId={request.id} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Something not right?{" "}
          <Link href="/safeguarding/report" className="underline">
            Report a safeguarding concern
          </Link>
          , or speak to a club administrator.
        </p>
      </div>
    </div>
  );
}
