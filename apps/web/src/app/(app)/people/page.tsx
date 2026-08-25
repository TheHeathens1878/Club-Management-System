import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Search } from "lucide-react";

import type { Enums } from "@club/db";

import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { signPeoplePhotos } from "@/lib/avatars";
import { isClubAdmin } from "@/lib/person";
import { isMinorDob, personLabel, sanitiseSearch } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

/**
 * The club's contacts database (gap 2).
 *
 * Read through the caller's own client. `people_admin_read` gives the whole
 * list to a club_admin or the safeguarding lead and to nobody else, so an empty
 * page is the database's answer, not a bug — and it is the same answer whether
 * the app's committee gate is right or wrong.
 *
 * WHAT A "TYPE" IS. The chips answer the three questions the club actually
 * asks of this list, and each is answered by a LINK the database holds, not by
 * a label somebody typed:
 *
 *   · Player  — a live `team_memberships` row with role `player`.
 *   · Coach   — a live `team_memberships` row with a staff role
 *               (coach / assistant_coach / manager), or the `coach` app role.
 *   · Parent  — a live `guardianships` row on the guardian side, or the
 *               `parent` app role. SAFEGUARDING.md §1.3 is emphatic that
 *               authority comes from the LINK and never from the role, so the
 *               link is listed first and the role is only a second way of being
 *               found on a search screen — nothing here grants anything.
 *
 * Everything derived from `team_memberships` is scoped to the current season,
 * the same scoping the team filter has always used; with no current season set
 * the team-derived halves are empty and the card says so.
 *
 * The whole row is a link to `/people/[id]`, which is the only place a person
 * is edited. There are no inline actions: a contacts list that can also change
 * records is a list you cannot skim safely.
 *
 * The minor badge is computed from `dob` with the same rule as
 * `public.is_minor_dob()` (SG-0: an unknown date of birth is a minor). It is a
 * label on a screen only committee reach; every decision that matters still
 * asks the database.
 */

/** Enough to scan, few enough that the per-page enrichment stays four queries. */
const PAGE_SIZE = 25;

const ROLES: Enums<"app_role">[] = [
  "club_admin",
  "safeguarding_lead",
  "coach",
  "staff",
  "member",
  "parent",
  "hirer",
  "referee",
];

const ROLE_LABELS: Record<Enums<"app_role">, string> = {
  club_admin: "Club admin",
  safeguarding_lead: "Safeguarding lead",
  coach: "Coach",
  staff: "Staff",
  member: "Member",
  parent: "Parent",
  hirer: "Hirer",
  referee: "Referee",
};

/** The staff half of `team_role` — everything that is not a player. */
const TEAM_STAFF_ROLES: Enums<"team_role">[] = ["coach", "assistant_coach", "manager"];

const TYPES = ["player", "parent", "coach"] as const;
type ContactType = (typeof TYPES)[number];

const TYPE_LABELS: Record<ContactType, string> = {
  player: "Player",
  parent: "Parent",
  coach: "Coach",
};

const TYPE_BADGE_VARIANT: Record<ContactType, "default" | "success" | "muted"> = {
  player: "default",
  parent: "success",
  coach: "muted",
};

/** Teams are listed in full up to this many, then counted. */
const TEAMS_SHOWN = 2;


type SearchParams = {
  q?: string;
  type?: string;
  filter?: string;
  role?: string;
  team?: string;
  page?: string;
};

/** `null` means "no restriction"; an empty array means "restricted to nobody". */
function intersect(current: string[] | null, ids: string[]): string[] {
  return current === null ? ids : current.filter((id) => ids.includes(id));
}

/** The query string the list is currently showing, with `overrides` applied. */
function listQuery(params: SearchParams, overrides: Partial<SearchParams> = {}): string {
  const merged = { ...params, ...overrides };
  const query = new URLSearchParams();
  if (merged.q) query.set("q", merged.q);
  if (merged.type) query.set("type", merged.type);
  if (merged.filter) query.set("filter", merged.filter);
  if (merged.role) query.set("role", merged.role);
  if (merged.team) query.set("team", merged.team);
  if (merged.page && merged.page !== "1") query.set("page", merged.page);
  return query.toString();
}

function buildHref(params: SearchParams, overrides: Partial<SearchParams> = {}): string {
  const text = listQuery(params, overrides);
  return text ? `/people?${text}` : "/people";
}

/**
 * The row link. `from` carries the list's own query string so `/people/[id]`
 * can offer a Back that lands on the page, filters and chip the reader left.
 */
function personHref(personId: string, params: SearchParams, page: number): string {
  const text = listQuery(params, { page: String(page) });
  return text ? `/people/${personId}?from=${encodeURIComponent(text)}` : `/people/${personId}`;
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/lobby");

  const params = await searchParams;
  const term = sanitiseSearch(params.q ?? "");
  const noDob = params.filter === "no_dob";
  const roleFilter = ROLES.includes(params.role as Enums<"app_role">)
    ? (params.role as Enums<"app_role">)
    : null;
  const teamFilter = params.team && params.team !== "" ? params.team : null;
  const typeFilter = TYPES.includes(params.type as ContactType)
    ? (params.type as ContactType)
    : null;
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const supabase = await createClient();

  const [{ data: teams }, { data: currentSeason }] = await Promise.all([
    supabase.from("teams").select("id,name").order("sort_order").order("name"),
    supabase.from("seasons").select("id,name").eq("is_current", true).maybeSingle(),
  ]);

  const teamNames = new Map((teams ?? []).map((team) => [team.id, team.name] as const));

  // The filters that are answered by another table become an id list the
  // people query intersects with. Each is one query, whatever the page size.
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
  if (teamFilter && !currentSeason) {
    // No season, no live membership to match — say "nobody" rather than
    // silently ignoring the filter the user picked.
    restricted = intersect(restricted, []);
  }
  // The design's two extra chips (spec §2.7): Committee, and Under 18 — where
  // a missing date of birth counts as under 18, exactly as SG-0 treats it.
  const committeeFilter = params.type === "committee";
  const under18Filter = params.type === "under18";

  if (committeeFilter) {
    const { data } = await supabase
      .from("profiles")
      .select("person_id")
      .in("role", ["committee", "super_user"])
      .not("person_id", "is", null);
    restricted = intersect(
      restricted,
      (data ?? []).map((r) => r.person_id).filter((id): id is string => !!id),
    );
  }

  if (typeFilter) {
    const ids = new Set<string>();

    if (typeFilter === "player" && currentSeason) {
      const { data } = await supabase
        .from("team_memberships")
        .select("person_id")
        .eq("season_id", currentSeason.id)
        .eq("role", "player")
        .is("left_at", null);
      for (const row of data ?? []) ids.add(row.person_id);
    }

    if (typeFilter === "coach") {
      const [memberships, roles] = await Promise.all([
        currentSeason
          ? supabase
              .from("team_memberships")
              .select("person_id")
              .eq("season_id", currentSeason.id)
              .in("role", TEAM_STAFF_ROLES)
              .is("left_at", null)
          : Promise.resolve({ data: [] as { person_id: string }[] }),
        supabase
          .from("person_roles")
          .select("person_id")
          .eq("role", "coach")
          .is("revoked_at", null),
      ]);
      for (const row of memberships.data ?? []) ids.add(row.person_id);
      for (const row of roles.data ?? []) ids.add(row.person_id);
    }

    if (typeFilter === "parent") {
      const [links, roles] = await Promise.all([
        supabase.from("guardianships").select("guardian_person_id").is("ended_at", null),
        supabase
          .from("person_roles")
          .select("person_id")
          .eq("role", "parent")
          .is("revoked_at", null),
      ]);
      for (const row of links.data ?? []) ids.add(row.guardian_person_id);
      for (const row of roles.data ?? []) ids.add(row.person_id);
    }

    restricted = intersect(restricted, [...ids]);
  }

  const impossible = restricted !== null && restricted.length === 0;

  // Hirers are NOT members (Adam, 2026-08-25). This used to look for a
  // `booker` profile — a marker that does not exist in this database, so it
  // matched nothing and 27 room customers sat in the club's contact list.
  // `hire_only_person_ids()` (20260825360000) asks the question the screen
  // means instead: no team, no registration, no guardianship, no membership,
  // no role, no staff login, no account request — and a matching hire contact
  // or booking. Nobody is re-roled; they are simply somebody else's list.
  const { data: hirerIds } = await supabase.rpc("hire_only_person_ids");
  const hirerPersonIds = (hirerIds ?? []) as string[];

  let query = supabase
    .from("people")
    .select("id,first_name,last_name,preferred_name,dob,email,phone,photo_path", { count: "exact" })
    .is("deleted_at", null);
  if (hirerPersonIds.length > 0) {
    query = query.not("id", "in", `(${hirerPersonIds.join(",")})`);
  }

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
  if (under18Filter) {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    const iso = cutoff.toISOString().slice(0, 10);
    query = query.or(`dob.gt.${iso},dob.is.null`);
  }
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
  // One signing call for the whole page, not one per row.
  const photoUrls = await signPeoplePhotos(people);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Enrichment for the page's rows only — four bulk reads, not four per row.
  const [rolesResult, membershipsResult, guardianshipsResult, profilesResult] =
    ids.length === 0
      ? [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]
      : await Promise.all([
          supabase
            .from("person_roles")
            .select("person_id,role")
            .in("person_id", ids)
            .is("revoked_at", null),
          currentSeason
            ? supabase
                .from("team_memberships")
                .select("person_id,team_id,role")
                .in("person_id", ids)
                .eq("season_id", currentSeason.id)
                .is("left_at", null)
            : Promise.resolve({
                data: [] as { person_id: string; team_id: string; role: Enums<"team_role"> }[],
              }),
          supabase
            .from("guardianships")
            .select("guardian_person_id")
            .in("guardian_person_id", ids)
            .is("ended_at", null),
          supabase.from("profiles").select("person_id").in("person_id", ids),
        ]);

  const appRoles = new Map<string, Set<Enums<"app_role">>>();
  for (const row of rolesResult.data ?? []) {
    const held = appRoles.get(row.person_id) ?? new Set<Enums<"app_role">>();
    held.add(row.role);
    appRoles.set(row.person_id, held);
  }

  const teamsByPerson = new Map<string, string[]>();
  const typesByPerson = new Map<string, Set<ContactType>>();
  const addType = (personId: string, type: ContactType) => {
    const held = typesByPerson.get(personId) ?? new Set<ContactType>();
    held.add(type);
    typesByPerson.set(personId, held);
  };

  for (const row of membershipsResult.data ?? []) {
    const name = teamNames.get(row.team_id);
    if (name) teamsByPerson.set(row.person_id, [...(teamsByPerson.get(row.person_id) ?? []), name]);
    addType(row.person_id, row.role === "player" ? "player" : "coach");
  }
  for (const row of guardianshipsResult.data ?? []) addType(row.guardian_person_id, "parent");
  for (const [personId, held] of appRoles) {
    if (held.has("coach")) addType(personId, "coach");
    if (held.has("parent")) addType(personId, "parent");
  }

  const withLogin = new Set((profilesResult.data ?? []).map((p) => p.person_id));

  // The design's row details: a minor's contact goes through their guardian
  // ("via Kate Ashworth"), a pending account request reads Needs review, and a
  // staff DBS inside 90 days of expiry reads DBS due. Three more bulk reads
  // for the page's rows only.
  const minorIds = people.filter((p) => isMinorDob(p.dob)).map((p) => p.id);
  const [guardiansResult, requestsResult, dbsResult] = await Promise.all([
    minorIds.length > 0
      ? supabase
          .from("guardianships")
          .select("child_person_id,guardian_person_id")
          .in("child_person_id", minorIds)
          .is("ended_at", null)
      : Promise.resolve({ data: [] as { child_person_id: string; guardian_person_id: string }[] }),
    ids.length > 0
      ? supabase
          .from("account_requests")
          .select("person_id")
          .in("person_id", ids)
          .eq("status", "pending")
      : Promise.resolve({ data: [] as { person_id: string }[] }),
    ids.length > 0
      ? supabase
          .from("certifications")
          .select("person_id,expires_on")
          .in("person_id", ids)
          .eq("type", "fa_dbs")
          .is("revoked_at", null)
      : Promise.resolve({ data: [] as { person_id: string; expires_on: string | null }[] }),
  ]);

  const guardianOf = new Map<string, string>();
  const guardianIds = Array.from(
    new Set((guardiansResult.data ?? []).map((g) => g.guardian_person_id)),
  );
  const guardianPeople = new Map<string, { name: string; phone: string | null }>();
  if (guardianIds.length > 0) {
    const { data } = await supabase
      .from("people")
      .select("id,first_name,last_name,phone")
      .in("id", guardianIds);
    for (const row of data ?? []) {
      guardianPeople.set(row.id, {
        name: `${row.first_name} ${row.last_name}`.trim(),
        phone: row.phone,
      });
    }
  }
  for (const link of guardiansResult.data ?? []) {
    if (!guardianOf.has(link.child_person_id)) {
      guardianOf.set(link.child_person_id, link.guardian_person_id);
    }
  }

  const needsReview = new Set((requestsResult.data ?? []).map((r) => r.person_id));
  const dbsDue = new Set<string>();
  const dbsSoon = new Date();
  dbsSoon.setDate(dbsSoon.getDate() + 90);
  for (const cert of dbsResult.data ?? []) {
    if (cert.expires_on && new Date(cert.expires_on) <= dbsSoon) dbsDue.add(cert.person_id);
  }

  const chips: { key: string; label: string; href: string; active: boolean }[] = [
    {
      key: "all",
      label: "Everyone",
      href: buildHref(params, { type: undefined, page: undefined }),
      active: typeFilter === null && !committeeFilter && !under18Filter,
    },
    ...TYPES.map((type) => ({
      key: type,
      label: `${TYPE_LABELS[type]}s`,
      href: buildHref(params, { type, page: undefined }),
      active: typeFilter === type,
    })),
    {
      key: "committee",
      label: "Committee",
      href: buildHref(params, { type: "committee", page: undefined }),
      active: committeeFilter,
    },
    {
      key: "under18",
      label: "Under 18",
      href: buildHref(params, { type: "under18", page: undefined }),
      active: under18Filter,
    },
  ];

  const filtersApplied =
    term.length > 0 || noDob || roleFilter !== null || teamFilter !== null || typeFilter !== null;

  return (
    <>
      <PageHeader
        title="People"
        subtitle="The club's contacts database — players, parents, coaches and staff. Hirers live in the function room's own contacts book."
        action={
          <span className="flex w-full gap-2 lg:w-auto">
            {/* A plain anchor on purpose: this is a file download from a route
                handler, and Link would try to client-navigate/prefetch it. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/people/export"
              className={
                buttonVariants({ variant: "outline", size: "sm" }) +
                " min-h-[44px] flex-1 gap-2 lg:min-h-0 lg:flex-none"
              }
            >
              Export CSV
            </a>
            <Link
              href="/people/new"
              className={
                buttonVariants({ variant: "default", size: "sm" }) +
                " min-h-[44px] flex-1 gap-2 lg:min-h-0 lg:flex-none"
              }
            >
              <Plus className="h-4 w-4" /> Add a person
            </Link>
          </span>
        }
      />
      <div className="space-y-6 p-4 lg:p-6">
        <Card>
          <CardHeader className="space-y-3 p-4 lg:p-6">
            <CardTitle className="text-base">Find someone</CardTitle>
            {/* The chips scroll sideways in their own lane on a phone rather
                than wrapping into four lines. */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
              {chips.map((chip) => (
                <Link
                  key={chip.key}
                  href={chip.href}
                  aria-current={chip.active ? "true" : undefined}
                  className={
                    buttonVariants({
                      variant: chip.active ? "default" : "outline",
                      size: "sm",
                    }) + " min-h-[44px] shrink-0 whitespace-nowrap lg:min-h-0"
                  }
                >
                  {chip.label}
                </Link>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            {/* A GET form so every list is a URL somebody can bookmark or send.
                The type chip lives outside the form, so it rides along in a
                hidden field rather than being lost on the next search. */}
            <form method="get" className="grid gap-4 sm:grid-cols-6">
              {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="q">Name or email</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="q"
                    name="q"
                    defaultValue={params.q ?? ""}
                    placeholder="Search…"
                    className="min-h-[44px] pl-8 lg:min-h-0"
                  />
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="team">Team (this season)</Label>
                <Select
                  id="team"
                  name="team"
                  defaultValue={teamFilter ?? ""}
                  className="min-h-[44px] lg:min-h-0"
                >
                  <option value="">Any team</option>
                  {(teams ?? []).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  id="role"
                  name="role"
                  defaultValue={roleFilter ?? ""}
                  className="min-h-[44px] lg:min-h-0"
                >
                  <option value="">Any role</option>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </Select>
              </div>
              <label className="flex min-h-[44px] items-center gap-2 text-sm sm:col-span-4 lg:min-h-0">
                <input type="checkbox" name="filter" value="no_dob" defaultChecked={noDob} />
                Only people with no date of birth on file
              </label>
              <div className="flex items-end gap-2 sm:col-span-2">
                <button
                  type="submit"
                  className={
                    buttonVariants({ variant: "default", size: "sm" }) +
                    " min-h-[44px] flex-1 lg:min-h-0 lg:flex-none"
                  }
                >
                  Search
                </button>
                {filtersApplied && (
                  <Link
                    href="/people"
                    className={
                      buttonVariants({ variant: "outline", size: "sm" }) +
                      " min-h-[44px] flex-1 lg:min-h-0 lg:flex-none"
                    }
                  >
                    Clear
                  </Link>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">
              {total} {total === 1 ? "person" : "people"}
              {!currentSeason && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (no current season, so teams and the player/coach types are blank)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
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
              <div>
                {/* A header, not a <table>: the whole row is one link, and a
                    link cannot wrap a <tr>. */}
                <div className="hidden border-b pb-2 text-xs text-muted-foreground lg:grid lg:grid-cols-12 lg:gap-3">
                  <span className="lg:col-span-3">Name</span>
                  <span className="lg:col-span-2">Type</span>
                  <span className="lg:col-span-2">Teams</span>
                  <span className="lg:col-span-3">Contact</span>
                  <span className="lg:col-span-2">Status</span>
                </div>
                <ul className="space-y-2 lg:space-y-0 lg:divide-y">
                  {people.map((person) => {
                    const name = personLabel(person);
                    const held = [...(typesByPerson.get(person.id) ?? [])];
                    const heldTeams = teamsByPerson.get(person.id) ?? [];
                    const extraTeams = heldTeams.length - TEAMS_SHOWN;
                    const linked = withLogin.has(person.id);
                    const minor = isMinorDob(person.dob);
                    const guardian = minor
                      ? guardianPeople.get(guardianOf.get(person.id) ?? "")
                      : undefined;
                    const shownTypes = TYPES.filter((type) => held.includes(type));
                    const teamsText =
                      heldTeams.length === 0
                        ? "—"
                        : heldTeams.slice(0, TEAMS_SHOWN).join(", ") +
                          (extraTeams > 0 ? ` +${extraTeams}` : "");
                    // One status per person, so the card and the table row can
                    // never drift apart.
                    const status = needsReview.has(person.id)
                      ? { label: "Needs review", variant: "destructive" as const }
                      : dbsDue.has(person.id)
                        ? { label: "DBS due", variant: "warning" as const }
                        : minor
                          ? { label: "Registered", variant: "success" as const }
                          : linked
                            ? { label: "Active", variant: "success" as const }
                            : { label: "No login", variant: "muted" as const };
                    const href = personHref(person.id, params, page);
                    return (
                      <li key={person.id}>
                        {/* The phone's card: avatar, name, the muted role and
                            contact lines, team and status down the right. */}
                        <Link
                          href={href}
                          className="flex min-h-[44px] items-start gap-3 rounded-xl border bg-card p-3 lg:hidden"
                        >
                          <span className="relative inline-flex flex-none">
                            <Avatar name={name} photoUrl={photoUrls.get(person.id)} />
                            <span
                              className={
                                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card " +
                                (linked ? "bg-emerald-500" : "bg-muted-foreground/30")
                              }
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium leading-tight">{name}</span>
                              {minor && (
                                <Badge variant="warning">
                                  {person.dob ? "Minor" : "No DOB"}
                                </Badge>
                              )}
                            </span>
                            <span className="sr-only">
                              {linked ? "Has a login." : "No login yet."}
                            </span>
                            <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-muted-foreground">
                              {shownTypes.length === 0
                                ? "No type recorded"
                                : shownTypes.map((type) => TYPE_LABELS[type]).join(" · ")}
                            </span>
                            <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-muted-foreground">
                              {minor && guardian
                                ? `via ${guardian.name} · ${guardian.phone ?? "No phone"}`
                                : `${person.email ?? "No email"} · ${person.phone ?? "No phone"}`}
                            </span>
                          </span>
                          <span className="flex max-w-[104px] flex-none flex-col items-end gap-1">
                            <Badge variant={status.variant} className="whitespace-nowrap">
                              {status.label}
                            </Badge>
                            <span className="w-full truncate text-right text-[11px] leading-tight text-muted-foreground">
                              {teamsText}
                            </span>
                          </span>
                        </Link>

                        <Link
                          href={href}
                          className="hidden gap-x-3 gap-y-1 rounded-md px-2 py-3 text-sm transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none lg:grid lg:grid-cols-12 lg:items-center"
                        >
                          <span className="flex flex-wrap items-center gap-2 lg:col-span-3">
                            <span
                              aria-hidden="true"
                              title={linked ? "Has a login" : "No login yet"}
                              className={
                                "h-2 w-2 shrink-0 rounded-full " +
                                (linked ? "bg-emerald-500" : "bg-muted-foreground/30")
                              }
                            />
                            <span className="font-medium">{name}</span>
                            <span className="sr-only">
                              {linked ? "Has a login." : "No login yet."}
                            </span>
                            {minor && (
                              <Badge variant="warning">
                                {person.dob ? "Minor" : "No DOB — treated as a minor"}
                              </Badge>
                            )}
                          </span>
                          <span className="flex flex-wrap gap-1 lg:col-span-2">
                            {held.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              shownTypes.map((type) => (
                                <Badge key={type} variant={TYPE_BADGE_VARIANT[type]}>
                                  {TYPE_LABELS[type]}
                                </Badge>
                              ))
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground lg:col-span-2">
                            {teamsText}
                          </span>
                          <span className="text-xs text-muted-foreground lg:col-span-3">
                            {/* The design's rule, stated on the page: an
                                under-18's contact goes through their guardian. */}
                            {minor && guardian ? (
                              <>
                                <span className="block">via {guardian.name}</span>
                                <span className="block">{guardian.phone ?? "No phone"}</span>
                              </>
                            ) : (
                              <>
                                <span className="block break-all">
                                  {person.email ?? "No email"}
                                </span>
                                <span className="block">{person.phone ?? "No phone"}</span>
                              </>
                            )}
                          </span>
                          <span className="lg:col-span-2">
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {people.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Contact details for under-18s are shown through their guardian.
              </p>
            )}

            {lastPage > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Page {page} of {lastPage}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={buildHref(params, { page: String(page - 1) })}
                      className={
                        buttonVariants({ variant: "outline", size: "sm" }) +
                        " min-h-[44px] lg:min-h-0"
                      }
                    >
                      Previous
                    </Link>
                  )}
                  {page < lastPage && (
                    <Link
                      href={buildHref(params, { page: String(page + 1) })}
                      className={
                        buttonVariants({ variant: "outline", size: "sm" }) +
                        " min-h-[44px] lg:min-h-0"
                      }
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
