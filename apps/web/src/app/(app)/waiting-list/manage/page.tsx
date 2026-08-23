import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ClipboardList,
  Download,
  ExternalLink,
  HeartHandshake,
  KeyRound,
  ListOrdered,
} from "lucide-react";

import type { Database } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { getSessionProfile } from "@/lib/auth";
import { isClubAdmin, nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVE_STATUSES,
  STATUS_LABELS,
  TEAM_PREFERENCE_LABELS,
  WAITING_LIST_STATUSES,
  ageGroupSortKey,
  isWaitingListStatus,
  statusVariant,
  type WaitingListStatus,
} from "@/lib/waiting-list";

import { AgeGroupsPanel, type AgeGroupSetting } from "./age-groups-panel";
import { NoteForm, StatusForm } from "./entry-actions";
import { PrioritiesPanel, type PriorityGroup } from "./priorities-panel";

/**
 * The waiting list desk (PLAN.md P3.4) — the pitch-booking app's admin waiting
 * list screens, rebuilt on this platform's RLS.
 *
 * User-scoped client throughout. A club administrator sees every entry; a
 * coach sees only the age groups they hold a `waiting_list_access` row for,
 * because that is what the policy returns — the page does no filtering of its
 * own to achieve it. The admin-only controls (status, age group availability)
 * are hidden when `is_club_admin()` says no, and refused by the database
 * anyway if they are somehow posted.
 */

type Entry = Database["public"]["Tables"]["waiting_list_entries"]["Row"];
type Note = Pick<
  Database["public"]["Tables"]["waiting_list_notes"]["Row"],
  "id" | "entry_id" | "body" | "author_person_id" | "created_at"
>;

function formatDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatStamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

export default async function WaitingListDeskPage({
  searchParams,
}: {
  searchParams: Promise<{
    age_group?: string;
    status?: string;
    coaching?: string;
    show_all?: string;
    mode?: string;
  }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const params = await searchParams;
  const statusFilter =
    params.status && isWaitingListStatus(params.status) ? params.status : undefined;
  const ageGroupFilter = params.age_group?.trim() || undefined;
  const coachingOnly = params.coaching === "1";
  const showAll = params.show_all === "1";
  const prioritiesMode = params.mode === "priorities";

  // The filters, as a query string — so "export what I am looking at" and the
  // link into priorities mode both carry exactly what is on screen.
  const filterQuery = new URLSearchParams();
  if (statusFilter) filterQuery.set("status", statusFilter);
  if (ageGroupFilter) filterQuery.set("age_group", ageGroupFilter);
  if (coachingOnly) filterQuery.set("coaching", "1");
  if (showAll) filterQuery.set("show_all", "1");
  const filterSuffix = filterQuery.toString() ? `?${filterQuery.toString()}` : "";
  const exportHref = `/waiting-list/manage/export${filterSuffix}`;
  const prioritiesQuery = new URLSearchParams(filterQuery);
  prioritiesQuery.set("mode", "priorities");
  const prioritiesHref = `/waiting-list/manage?${prioritiesQuery.toString()}`;

  const supabase = await createClient();

  let query = supabase.from("waiting_list_entries").select("*");
  if (statusFilter) {
    query = query.eq("status", statusFilter);
  } else if (!showAll) {
    query = query.in("status", [...ACTIVE_STATUSES]);
  }
  if (ageGroupFilter) query = query.eq("age_group", ageGroupFilter);
  if (coachingOnly) query = query.eq("coaching_interest", true);

  const [{ data: entryRows, error: entriesError }, { data: settingRows }, { data: accessRows }, admin] =
    await Promise.all([
      query
        .order("status")
        .order("priority", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
      supabase
        .from("waiting_list_age_groups")
        .select("age_group, is_open, is_publicly_advertised"),
      supabase.from("waiting_list_access").select("age_group"),
      isClubAdmin(),
    ]);

  const entries: Entry[] = entryRows ?? [];
  const ageGroupSettings: AgeGroupSetting[] = (settingRows ?? [])
    .slice()
    .sort((a, b) => ageGroupSortKey(a.age_group).localeCompare(ageGroupSortKey(b.age_group)));
  const myAgeGroups = (accessRows ?? []).map((row) => row.age_group);

  // Notes come back under the same policies as the entries, so anything the
  // caller may not read simply is not here.
  let notes: Note[] = [];
  if (entries.length > 0) {
    const { data } = await supabase
      .from("waiting_list_notes")
      .select("id, entry_id, body, author_person_id, created_at")
      .in(
        "entry_id",
        entries.map((entry) => entry.id),
      )
      .order("created_at", { ascending: true });
    notes = data ?? [];
  }

  const notesByEntry = new Map<string, Note[]>();
  for (const note of notes) {
    const list = notesByEntry.get(note.entry_id);
    if (list) list.push(note);
    else notesByEntry.set(note.entry_id, [note]);
  }

  const authorNames = await resolveNames(
    notes.map((note) => note.author_person_id).filter((id): id is string => Boolean(id)),
  );

  // Filter options: the groups the caller can actually see something for.
  const filterAgeGroups = Array.from(
    new Set([
      ...ageGroupSettings.map((setting) => setting.age_group),
      ...myAgeGroups,
      ...entries.map((entry) => entry.age_group),
    ]),
  ).sort((a, b) => ageGroupSortKey(a).localeCompare(ageGroupSortKey(b)));

  const noAccess = !admin && myAgeGroups.length === 0 && entries.length === 0;
  const filtered = Boolean(statusFilter || ageGroupFilter || coachingOnly);

  // Priorities are a club administrator's tool: a coach has no UPDATE policy
  // on the entries, so the mode is not offered to one at all.
  const showPriorities = prioritiesMode && admin;
  const priorityGroups: PriorityGroup[] = (() => {
    if (!showPriorities) return [];
    const byGroup = new Map<string, Entry[]>();
    for (const entry of entries) {
      const list = byGroup.get(entry.age_group);
      if (list) list.push(entry);
      else byGroup.set(entry.age_group, [entry]);
    }
    return Array.from(byGroup.entries())
      .map(([ageGroup, groupEntries]) => ({
        ageGroup,
        entries: groupEntries
          .slice()
          .sort((a, b) => {
            const left = a.priority ?? Number.MAX_SAFE_INTEGER;
            const right = b.priority ?? Number.MAX_SAFE_INTEGER;
            if (left !== right) return left - right;
            return a.created_at.localeCompare(b.created_at);
          })
          .map((entry) => ({
            id: entry.id,
            playerName: entry.player_name,
            status: entry.status,
            priority: entry.priority,
          })),
      }))
      .sort((a, b) => ageGroupSortKey(a.ageGroup).localeCompare(ageGroupSortKey(b.ageGroup)));
  })();

  return (
    <>
      <PageHeader
        title="Waiting list"
        subtitle={
          admin
            ? "Everyone waiting for a place"
            : myAgeGroups.length > 0
              ? `Your age groups: ${myAgeGroups.join(", ")}`
              : "Players waiting for a place"
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={exportHref}
              className={buttonVariants({ variant: "outline", size: "sm" }) + " gap-2"}
            >
              <Download className="h-4 w-4" /> Export CSV
            </a>
            {admin && (
              <Link
                href="/waiting-list/manage/access"
                className={buttonVariants({ variant: "outline", size: "sm" }) + " gap-2"}
              >
                <KeyRound className="h-4 w-4" /> Access
              </Link>
            )}
            <Link
              href="/waiting-list"
              className={buttonVariants({ variant: "outline", size: "sm" }) + " gap-2"}
            >
              <ExternalLink className="h-4 w-4" /> Public form
            </Link>
          </div>
        }
      />

      <div className="max-w-5xl space-y-6 p-6">
        {admin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Age group availability</CardTitle>
              <p className="text-sm text-muted-foreground">
                A group that is not open is not offered on the public form, and a submission for it
                is refused. Closing a group does not affect the people already waiting.
              </p>
            </CardHeader>
            <CardContent>
              <AgeGroupsPanel settings={ageGroupSettings} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" /> Entries
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Pending first, then by priority and the date they applied. You see the age groups you
              have been given access to; a club administrator sees them all.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <form method="GET" className="flex flex-wrap items-end gap-2">
              <Select
                name="status"
                defaultValue={statusFilter ?? ""}
                aria-label="Status"
                className="h-9 w-auto min-w-48"
              >
                <option value="">
                  {showAll ? "All statuses" : "Active (pending, contacted, trialling)"}
                </option>
                {WAITING_LIST_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </option>
                ))}
              </Select>
              <Select
                name="age_group"
                defaultValue={ageGroupFilter ?? ""}
                aria-label="Age group"
                className="h-9 w-auto min-w-36"
              >
                <option value="">All age groups</option>
                {filterAgeGroups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </Select>
              <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 text-sm">
                <input
                  type="checkbox"
                  name="coaching"
                  value="1"
                  defaultChecked={coachingOnly}
                  className="h-4 w-4 accent-primary"
                />
                Willing to coach
              </label>
              {showAll && <input type="hidden" name="show_all" value="1" />}
              <Button type="submit" size="sm" variant="outline">
                Filter
              </Button>
              {filtered && (
                <Link
                  href={`/waiting-list/manage${showAll ? "?show_all=1" : ""}`}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Clear
                </Link>
              )}
            </form>

            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>
                {entries.length} {entries.length === 1 ? "entry" : "entries"} shown
              </span>
              {!statusFilter &&
                (showAll ? (
                  <Link href="/waiting-list/manage" className="text-primary hover:underline">
                    Active only
                  </Link>
                ) : (
                  <Link
                    href="/waiting-list/manage?show_all=1"
                    className="text-primary hover:underline"
                  >
                    Show all statuses
                  </Link>
                ))}
              {admin &&
                (showPriorities ? (
                  <Link
                    href={`/waiting-list/manage${filterSuffix}`}
                    className="text-primary hover:underline"
                  >
                    Back to the list
                  </Link>
                ) : (
                  <Link
                    href={prioritiesHref}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ListOrdered className="h-3.5 w-3.5" /> Priorities
                  </Link>
                ))}
            </div>

            {entriesError && (
              <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {entriesError.message}
              </p>
            )}

            {noAccess && (
              <p className="rounded-lg border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
                You have not been given access to any age group&apos;s waiting list. A club
                administrator can grant it.
              </p>
            )}

            {!noAccess && !showPriorities && entries.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No entries match those filters.
              </p>
            )}

            {showPriorities && <PrioritiesPanel groups={priorityGroups} />}

            {!showPriorities &&
              entries.map((entry) => {
              const entryNotes = notesByEntry.get(entry.id) ?? [];
              return (
                <details key={entry.id} className="group rounded-lg border bg-card">
                  <summary className="flex cursor-pointer select-none flex-wrap items-center gap-2 px-4 py-3 text-sm hover:bg-secondary/40">
                    {entry.priority !== null && (
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {entry.priority}
                      </span>
                    )}
                    <span className="font-medium">{entry.player_name}</span>
                    <Badge variant="outline">{entry.age_group}</Badge>
                    <Badge variant={statusVariant(entry.status)}>
                      {STATUS_LABELS[entry.status]}
                    </Badge>
                    {entry.coaching_interest && (
                      <Badge variant="success" className="gap-1">
                        <HeartHandshake className="h-3 w-3" /> Can coach
                      </Badge>
                    )}
                    <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        {entryNotes.length} {entryNotes.length === 1 ? "note" : "notes"}
                      </span>
                      <span>{formatDate(entry.created_at)}</span>
                    </span>
                  </summary>

                  <div className="space-y-4 border-t px-4 py-4">
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <Detail label="Date of birth">{formatDate(entry.dob)}</Detail>
                      <Detail label="School year">{entry.school_year ?? "—"}</Detail>
                      <Detail label="Biological sex">
                        {entry.biological_sex === "FEMALE" ? "Female" : "Male"}
                      </Detail>
                      {entry.team_preference && (
                        <Detail label="Team preference">
                          {TEAM_PREFERENCE_LABELS[entry.team_preference] ?? entry.team_preference}
                        </Detail>
                      )}
                      {entry.school && <Detail label="School">{entry.school}</Detail>}
                      <Detail label="Parent or guardian">{entry.parent_name}</Detail>
                      <Detail label="Email">
                        <a href={`mailto:${entry.parent_email}`} className="text-primary hover:underline">
                          {entry.parent_email}
                        </a>
                      </Detail>
                      <Detail label="Phone">
                        <a href={`tel:${entry.parent_phone}`} className="text-primary hover:underline">
                          {entry.parent_phone}
                        </a>
                      </Detail>
                      {entry.health_conditions && (
                        <div className="sm:col-span-2">
                          <Detail label="Health conditions">{entry.health_conditions}</Detail>
                        </div>
                      )}
                      {entry.coaching_interest && (
                        <div className="sm:col-span-2">
                          <Detail label="Coaching">
                            Willing to help coach
                            {entry.coaching_note ? ` — ${entry.coaching_note}` : ""}
                          </Detail>
                        </div>
                      )}
                      <Detail label="Applied">{formatStamp(entry.created_at)}</Detail>
                      <Detail label="Source">{entry.source}</Detail>
                    </dl>

                    {admin && (
                      <div className="border-t pt-4">
                        <StatusForm entryId={entry.id} status={entry.status as WaitingListStatus} />
                      </div>
                    )}

                    <div className="space-y-3 border-t pt-4">
                      <p className="text-xs uppercase text-muted-foreground">Notes</p>
                      {entryNotes.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No notes yet.</p>
                      ) : (
                        <ul className="space-y-2">
                          {entryNotes.map((note) => (
                            <li key={note.id} className="rounded-md bg-secondary/40 px-3 py-2 text-sm">
                              <p className="whitespace-pre-wrap">{note.body}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {nameOf(authorNames, note.author_person_id)} ·{" "}
                                {formatStamp(note.created_at)}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                      <NoteForm entryId={entry.id} />
                    </div>
                  </div>
                </details>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
