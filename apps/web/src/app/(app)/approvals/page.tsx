import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert, UserCheck } from "lucide-react";

import type { Database } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  STATUS_LABELS,
  formatDate,
  formatStamp,
  roleLabel,
  statusVariant,
} from "@/lib/account-requests";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { DecisionPanel } from "./decision-forms";
import { LeaveDecisionForms } from "./leave-request-forms";

/**
 * The approvals queue (gap 4) — the Neon app's /admin/approvals, rebuilt.
 *
 * A club administrator's screen. `account_requests_admin_read` is what returns
 * the rows; the page is gated as well so that someone without the role lands
 * somewhere useful instead of on an empty list they cannot explain.
 *
 * Whether the applicant is a minor is the database's answer (`is_minor_dob`),
 * and SG-0's rule holds here too: an unknown date of birth counts as a minor.
 * It is shown because it is the single fact that decides whether SG-6 will let
 * a coach onto that team at all.
 */

export const dynamic = "force-dynamic";

type RequestRow = Pick<
  Database["public"]["Tables"]["account_requests"]["Row"],
  | "id"
  | "person_id"
  | "requested_role"
  | "team_id"
  | "message"
  | "status"
  | "decision_note"
  | "created_at"
  | "decided_at"
>;

type PersonRow = Pick<
  Database["public"]["Tables"]["people"]["Row"],
  "id" | "first_name" | "last_name" | "preferred_name" | "email" | "dob"
>;

const DECIDED_STATUSES = ["approved", "rejected", "withdrawn"] as const;

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!(await isClubAdmin())) redirect("/welcome");

  const { tab } = await searchParams;
  const decided = tab === "decided";

  const supabase = await createClient();
  const query = supabase
    .from("account_requests")
    .select(
      "id,person_id,requested_role,team_id,message,status,decision_note,created_at,decided_at",
    );
  const { data: requestRows } = decided
    ? await query.in("status", DECIDED_STATUSES).order("decided_at", { ascending: false }).limit(200)
    : await query.eq("status", "pending").order("created_at");
  const requests: RequestRow[] = requestRows ?? [];

  const personIds = Array.from(new Set(requests.map((r) => r.person_id)));
  const teamIds = Array.from(new Set(requests.map((r) => r.team_id).filter((id): id is string => !!id)));

  // Team applications live on the registrations desk, but an administrator who
  // opens THIS page looking for "the approval" must not be met with silence —
  // Adam applied for a player and found nothing here. Count them and say so.
  const [{ data: peopleRows }, { data: teamRows }, { data: pendingRegistrations }] =
    await Promise.all([
      personIds.length
        ? supabase.from("people").select("id,first_name,last_name,preferred_name,email,dob").in("id", personIds)
        : Promise.resolve({ data: [] as PersonRow[] }),
      teamIds.length
        ? supabase.from("teams").select("id,name").in("id", teamIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      supabase
        .from("registrations")
        .select("id,person_id,team_id")
        .eq("status", "pending")
        .limit(50),
    ]);

  const registrationCount = (pendingRegistrations ?? []).length;
  const registrationNames = registrationCount
    ? await (async () => {
        const ids = Array.from(new Set((pendingRegistrations ?? []).map((r) => r.person_id)));
        const { data } = await supabase
          .from("people")
          .select("id,first_name,last_name")
          .in("id", ids);
        return (data ?? []).map((p) => `${p.first_name} ${p.last_name}`);
      })()
    : [];

  const people = new Map((peopleRows ?? []).map((p) => [p.id, p]));
  const teamNames = new Map((teamRows ?? []).map((t) => [t.id, t.name]));

  // ------------------------------------------------------------------
  // "This player has left" (Adam, 2026-08-25) — a coach's squad change,
  // waiting for the administrator who is the only one who may make it.
  //
  // Its own queue rather than a row among the account requests: approving one
  // ENDS A MEMBERSHIP, which is a different act from granting someone a role,
  // and `decide_leave_request()` is a different RPC. The account-request queue
  // below is untouched.
  // ------------------------------------------------------------------
  const { data: leaveRows } = await supabase
    .from("team_membership_leave_requests")
    .select("id,person_id,team_id,requested_by_person_id,note,created_at")
    .eq("status", "pending")
    .order("created_at");
  const leaveRequests = leaveRows ?? [];

  const leavePersonIds = Array.from(
    new Set(
      leaveRequests
        .flatMap((row) => [row.person_id, row.requested_by_person_id])
        .filter((value): value is string => !!value),
    ),
  );
  const leaveTeamIds = Array.from(new Set(leaveRequests.map((row) => row.team_id)));
  const [{ data: leavePeopleRows }, { data: leaveTeamRows }] = await Promise.all([
    leavePersonIds.length
      ? supabase.from("people").select("id,first_name,last_name,preferred_name").in("id", leavePersonIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string; preferred_name: string | null }[] }),
    leaveTeamIds.length
      ? supabase.from("teams").select("id,name").in("id", leaveTeamIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const leaveNames = new Map(
    (leavePeopleRows ?? []).map((p) => [
      p.id,
      `${p.preferred_name || p.first_name} ${p.last_name}`.trim(),
    ]),
  );
  const leaveTeams = new Map((leaveTeamRows ?? []).map((t) => [t.id, t.name]));

  // One call per distinct date of birth, not per request.
  const dobs = Array.from(
    new Set((peopleRows ?? []).map((p) => p.dob).filter((d): d is string => !!d)),
  );
  const minorByDob = new Map<string, boolean>();
  await Promise.all(
    dobs.map(async (dob) => {
      const { data } = await supabase.rpc("is_minor_dob", { d: dob });
      minorByDob.set(dob, data === true);
    }),
  );

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="People who have signed up and told us what they are. Approving a coach or a player writes the team membership; approving a parent grants the parent role."
        action={
          <Link
            href="/people"
            className={
              buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] lg:min-h-0"
            }
          >
            People
          </Link>
        }
      />

      <div className="space-y-6 p-4 lg:p-8">
        {registrationCount > 0 ? (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm">
                <span className="font-semibold">
                  {registrationCount === 1
                    ? "1 team application is waiting"
                    : `${registrationCount} team applications are waiting`}
                </span>
                {registrationNames.length > 0 ? (
                  <span className="text-muted-foreground">
                    {" "}
                    — {registrationNames.slice(0, 4).join(", ")}
                    {registrationNames.length > 4 ? ` and ${registrationNames.length - 4} more` : ""}
                  </span>
                ) : null}
                <span className="block text-xs text-muted-foreground">
                  Applications to join a team are decided on the registrations desk — approving one
                  writes the player&apos;s team membership for the season.
                </span>
              </p>
              <Link
                href="/registrations"
                className={
                  buttonVariants({ size: "sm" }) + " min-h-[44px] w-full lg:min-h-0 lg:w-auto"
                }
              >
                Review registrations
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {!decided && leaveRequests.length > 0 ? (
          <Card>
            <CardHeader className="p-4 pb-3 lg:p-6 lg:pb-3">
              <CardTitle className="text-base">
                Squad changes ({leaveRequests.length})
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                A coach has reported that a player has left. Approving one ends that team
                membership — the same act as End on the team&apos;s Squad tab, which is why it is
                yours alone. The record is kept either way; nothing is deleted, and the coach is
                told what you decided.
              </p>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0">
              <ul className="space-y-4">
                {leaveRequests.map((row) => {
                  const who = leaveNames.get(row.person_id) ?? "Club member";
                  const asker = row.requested_by_person_id
                    ? (leaveNames.get(row.requested_by_person_id) ?? "A coach")
                    : "A coach";
                  return (
                    <li key={row.id} className="space-y-3 rounded-lg border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">
                            <Link href={`/people/${row.person_id}`} className="hover:underline">
                              {who}
                            </Link>
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {leaveTeams.get(row.team_id) ?? "Team"} · reported by {asker} ·{" "}
                            {formatStamp(row.created_at)}
                          </p>
                        </div>
                        <Link
                          href={`/teams/${row.team_id}?tab=squad`}
                          className={
                            buttonVariants({ variant: "outline", size: "sm" }) +
                            " min-h-[44px] lg:min-h-0"
                          }
                        >
                          Open squad
                        </Link>
                      </div>

                      {row.note ? (
                        <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                          {row.note}
                        </p>
                      ) : null}

                      <LeaveDecisionForms
                        requestId={row.id}
                        personId={row.person_id}
                        personName={who}
                      />
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {/* The tab strip scrolls in its own lane on a phone. */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <Link
            href="/approvals"
            className={
              buttonVariants({ variant: decided ? "ghost" : "secondary", size: "sm" }) +
              " min-h-[44px] shrink-0 lg:min-h-0"
            }
          >
            Waiting
          </Link>
          <Link
            href="/approvals?tab=decided"
            className={
              buttonVariants({ variant: decided ? "secondary" : "ghost", size: "sm" }) +
              " min-h-[44px] shrink-0 lg:min-h-0"
            }
          >
            Decided
          </Link>
        </div>

        {requests.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              {decided ? "Nothing has been decided yet." : "Nothing is waiting. "}
              {decided ? null : (
                <>
                  New sign-ups appear here once they pick a role on{" "}
                  <Link href="/welcome" className="underline">
                    their welcome page
                  </Link>
                  .
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-4">
            {requests.map((request) => {
              const person = people.get(request.person_id);
              const name = person
                ? `${person.preferred_name || person.first_name} ${person.last_name}`.trim()
                : "Club member";
              const dob = person?.dob ?? null;
              const dobKnown = dob !== null;
              // SG-0: an unknown date of birth is treated as a minor.
              const minor = dob === null ? true : minorByDob.get(dob) === true;

              return (
                <li key={request.id}>
                  <Card>
                    <CardHeader className="p-4 pb-3 lg:p-6 lg:pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">
                            <Link href={`/people/${request.person_id}`} className="hover:underline">
                              {name}
                            </Link>
                          </CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {person?.email ?? "No email on record"} · asked{" "}
                            {formatStamp(request.created_at)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="default">{roleLabel(request.requested_role)}</Badge>
                          {request.team_id ? (
                            <Badge variant="outline">{teamNames.get(request.team_id) ?? "Team"}</Badge>
                          ) : null}
                          <Badge variant={statusVariant(request.status)}>
                            {STATUS_LABELS[request.status]}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0">
                      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="text-xs uppercase text-muted-foreground">Date of birth</dt>
                          <dd className="mt-0.5">
                            {dobKnown ? formatDate(dob) : "Not recorded"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase text-muted-foreground">Age status</dt>
                          <dd className="mt-0.5">
                            {minor ? (
                              <Badge variant="warning">
                                {dobKnown ? "Under 18" : "Treated as a minor (no date of birth)"}
                              </Badge>
                            ) : (
                              <Badge variant="muted">Adult</Badge>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase text-muted-foreground">Decided</dt>
                          <dd className="mt-0.5">{formatStamp(request.decided_at)}</dd>
                        </div>
                      </dl>

                      {request.message ? (
                        <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                          {request.message}
                        </p>
                      ) : null}

                      {request.decision_note ? (
                        <p
                          className={
                            "flex gap-2 whitespace-pre-wrap rounded-md p-3 text-sm " +
                            (request.status === "pending"
                              ? "bg-amber-50 text-amber-800"
                              : "bg-muted text-muted-foreground")
                          }
                        >
                          {request.status === "pending" ? (
                            <ShieldAlert className="h-4 w-4 shrink-0" />
                          ) : null}
                          <span>
                            {request.status === "pending" ? (
                              <span className="font-medium">Held: </span>
                            ) : null}
                            {request.decision_note}
                          </span>
                        </p>
                      ) : null}

                      {request.status === "pending" ? (
                        <DecisionPanel
                          requestId={request.id}
                          personId={request.person_id}
                          personName={name}
                        />
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <UserCheck className="h-3 w-3" />
          Every decision is recorded in the audit log, with who made it and when.
        </p>
      </div>
    </div>
  );
}
