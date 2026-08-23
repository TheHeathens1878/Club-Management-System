import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Plus, Search } from "lucide-react";

import type { Enums } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isMinorDob, personLabel, sanitiseSearch } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

/**
 * The club's people (gap 2).
 *
 * Read through the caller's own client. `people_admin_read` gives the whole
 * list to a club_admin or the safeguarding lead and to nobody else, so an empty
 * page is the database's answer, not a bug — and it is the same answer whether
 * the app's committee gate is right or wrong.
 *
 * The minor badge is computed from `dob` with the same rule as
 * `public.is_minor_dob()` (SG-0: an unknown date of birth is a minor). It is a
 * label on a screen only committee reach; every decision that matters still
 * asks the database.
 */

/** Enough to scan, few enough that the per-row enrichment stays one query each. */
const PAGE_SIZE = 25;

const ROLES: Enums<"app_role">[] = [
  "club_admin",
  "safeguarding_lead",
  "coach",
  "staff",
  "member",
  "parent",
  "hirer",
];

const ROLE_LABELS: Record<Enums<"app_role">, string> = {
  club_admin: "Club admin",
  safeguarding_lead: "Safeguarding lead",
  coach: "Coach",
  staff: "Staff",
  member: "Member",
  parent: "Parent",
  hirer: "Hirer",
};

type SearchParams = {
  q?: string;
  filter?: string;
  role?: string;
  team?: string;
  page?: string;
};

/** `null` means "no restriction"; an empty array means "restricted to nobody". */
function intersect(current: string[] | null, ids: string[]): string[] {
  return current === null ? ids : current.filter((id) => ids.includes(id));
}

function buildHref(params: SearchParams, page: number): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.filter) query.set("filter", params.filter);
  if (params.role) query.set("role", params.role);
  if (params.team) query.set("team", params.team);
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `/people?${text}` : "/people";
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/room-bookings");

  const params = await searchParams;
  const term = sanitiseSearch(params.q ?? "");
  const noDob = params.filter === "no_dob";
  const roleFilter = ROLES.includes(params.role as Enums<"app_role">)
    ? (params.role as Enums<"app_role">)
    : null;
  const teamFilter = params.team && params.team !== "" ? params.team : null;
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const supabase = await createClient();

  const [{ data: teams }, { data: currentSeason }] = await Promise.all([
    supabase.from("teams").select("id,name").order("sort_order").order("name"),
    supabase.from("seasons").select("id,name").eq("is_current", true).maybeSingle(),
  ]);

  // The two filters that are answered by another table become an id list the
  // people query intersects with.
  let restricted: string[] | null = null;

  if (roleFilter) {
    const { data } = await supabase
      .from("person_roles")
      .select("person_id")
      .eq("role", roleFilter)
      .is("revoked_at", null);
    restricted = intersect(restricted, (data ?? []).map((r) => r.person_id));
  }
  if (teamFilter && currentSeason) {
    const { data } = await supabase
      .from("team_memberships")
      .select("person_id")
      .eq("team_id", teamFilter)
      .eq("season_id", currentSeason.id)
      .is("left_at", null);
    restricted = intersect(restricted, (data ?? []).map((r) => r.person_id));
  }

  const impossible = restricted !== null && restricted.length === 0;

  let query = supabase
    .from("people")
    .select("id,first_name,last_name,preferred_name,dob,email,phone", { count: "exact" })
    .is("deleted_at", null);

  if (term.length > 0) {
    const pattern = `%${term}%`;
    query = query.or(
      [
        `first_name.ilike.${pattern}`,
        `last_name.ilike.${pattern}`,
        `preferred_name.ilike.${pattern}`,
        `email.ilike.${pattern}`,
      ].join(","),
    );
  }
  if (noDob) query = query.is("dob", null);
  if (restricted !== null) query = query.in("id", restricted);

  const from = (page - 1) * PAGE_SIZE;
  const {
    data: rows,
    count,
    error,
  } = impossible
    ? { data: [], count: 0, error: null }
    : await query
        .order("last_name")
        .order("first_name")
        .range(from, from + PAGE_SIZE - 1);

  const people = rows ?? [];
  const ids = people.map((p) => p.id);
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Enrichment for the page's rows only — three bulk reads, not three per row.
  const [rolesResult, membershipsResult, profilesResult] =
    ids.length === 0
      ? [{ data: [] }, { data: [] }, { data: [] }]
      : await Promise.all([
          supabase
            .from("person_roles")
            .select("person_id,role")
            .in("person_id", ids)
            .is("revoked_at", null),
          currentSeason
            ? supabase
                .from("team_memberships")
                .select("person_id,team_id")
                .in("person_id", ids)
                .eq("season_id", currentSeason.id)
                .is("left_at", null)
            : Promise.resolve({ data: [] as { person_id: string; team_id: string }[] }),
          supabase.from("profiles").select("person_id").in("person_id", ids),
        ]);

  const rolesByPerson = new Map<string, Enums<"app_role">[]>();
  for (const row of rolesResult.data ?? []) {
    rolesByPerson.set(row.person_id, [...(rolesByPerson.get(row.person_id) ?? []), row.role]);
  }
  const teamCount = new Map<string, number>();
  for (const row of membershipsResult.data ?? []) {
    teamCount.set(row.person_id, (teamCount.get(row.person_id) ?? 0) + 1);
  }
  const withLogin = new Set((profilesResult.data ?? []).map((p) => p.person_id));

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Every member record the club holds — players, coaches, parents and hirers"
        action={
          <Link
            href="/people/new"
            className={buttonVariants({ variant: "default", size: "sm" }) + " gap-2"}
          >
            <Plus className="h-4 w-4" /> Add a person
          </Link>
        }
      />
      <div className="max-w-5xl space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Find someone</CardTitle>
          </CardHeader>
          <CardContent>
            <form method="get" className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="q">Name or email</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="q"
                    name="q"
                    defaultValue={params.q ?? ""}
                    placeholder="Search…"
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <Select id="role" name="role" defaultValue={roleFilter ?? ""}>
                  <option value="">Any role</option>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="team">Team (this season)</Label>
                <Select id="team" name="team" defaultValue={teamFilter ?? ""}>
                  <option value="">Any team</option>
                  {(teams ?? []).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-3">
                <input type="checkbox" name="filter" value="no_dob" defaultChecked={noDob} />
                Only people with no date of birth on file
              </label>
              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  className={buttonVariants({ variant: "default", size: "sm" })}
                >
                  Search
                </button>
                <Link href="/people" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Clear
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {total} {total === 1 ? "person" : "people"}
              {!currentSeason && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (no current season, so team counts are blank)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error && (
              <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Could not load people. Your account may not hold the club_admin or safeguarding_lead
                role that the `people` policies ask for.
              </p>
            )}
            {!error && people.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nobody matches those filters.
              </p>
            )}
            {people.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Name</th>
                      <th className="py-2 pr-3 font-medium">Email</th>
                      <th className="py-2 pr-3 font-medium">Phone</th>
                      <th className="py-2 pr-3 font-medium">DOB</th>
                      <th className="py-2 pr-3 font-medium">Roles</th>
                      <th className="py-2 pr-3 font-medium">Teams</th>
                      <th className="py-2 pr-3 font-medium">Login</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => {
                      const roles = rolesByPerson.get(person.id) ?? [];
                      const teamsHeld = teamCount.get(person.id) ?? 0;
                      return (
                        <tr key={person.id} className="border-b align-top last:border-0">
                          <td className="py-2 pr-3">
                            <Link
                              href={`/people/${person.id}`}
                              className="font-medium underline underline-offset-2"
                            >
                              {personLabel(person)}
                            </Link>
                            {isMinorDob(person.dob) && (
                              <Badge variant="warning" className="ml-2">
                                Minor
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3 break-all">{person.email ?? "—"}</td>
                          <td className="py-2 pr-3">{person.phone ?? "—"}</td>
                          <td className="py-2 pr-3">
                            {person.dob ? (
                              <Badge variant="success">Known</Badge>
                            ) : (
                              <Badge variant="destructive">Missing</Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            {roles.length === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {roles.map((role) => (
                                  <Badge key={role} variant="muted">
                                    {ROLE_LABELS[role]}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-3">{teamsHeld === 0 ? "—" : teamsHeld}</td>
                          <td className="py-2 pr-3">
                            {withLogin.has(person.id) ? (
                              <Badge variant="default">Linked</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2">
                            <Link
                              href={`/people/${person.id}`}
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={`Open ${personLabel(person)}`}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {lastPage > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Page {page} of {lastPage}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={buildHref(params, page - 1)}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Previous
                    </Link>
                  )}
                  {page < lastPage && (
                    <Link
                      href={buildHref(params, page + 1)}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
