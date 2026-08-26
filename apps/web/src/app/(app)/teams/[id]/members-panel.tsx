"use client";

/**
 * The squad as a grid of cards (design: "Club CRM — Sidebar build", Squad
 * tab): a chip strip that filters, then one card per person — face, name, the
 * two or three facts that matter this week, and the guardian to ring at the
 * foot of it.
 *
 * Two groups, in the order a team sheet is read: the people running the team,
 * then the people playing (Adam, 2026-08-25). Each keeps its own grid under
 * its own heading.
 *
 * EVERY VALUE ON A CARD IS SOMETHING THE CLUB HOLDS. The design shows an
 * attendance percentage, a playing position and an age in years; the club
 * records none of those, so they are not here. What is here is the role, the
 * shirt, the age group, the minor flag, the next match's answer, the newest
 * subscription (committee only — the page does not load it for anyone else)
 * and the emergency contact.
 *
 * The club administrator's four edits are folded into a "Manage" disclosure
 * inside the card, so the grid stays a grid. A refusal from the database is
 * shown as it arrived, because the database's own words are the sentence the
 * administrator needs.
 *
 * Dates of birth are deliberately absent. The server sends a minor flag (from
 * `is_minor()`, which returns a boolean and nothing else); the date itself
 * belongs to the person's own record, behind the People screens.
 */

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { AlertTriangle, Clock } from "lucide-react";

import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { PersonPicker } from "@/components/person-picker";
import { formatStamp, todayIso } from "@/lib/people-display";
import {
  availabilityCell,
  matchesFilter,
  squadCounts,
  subsCell,
  type AvailabilityStatus,
  type SquadCardFacts,
  type SquadCell,
  type SquadFilter,
  type SquadSub,
  type SquadTone,
} from "@/lib/squad-cards";

import {
  addTeamMember,
  changeMemberRole,
  endMembership,
  requestMemberLeave,
  setShirtNumber,
  type MembershipActionState,
} from "./membership-actions";

const EMPTY: MembershipActionState = {};

export type TeamRoleValue = "player" | "coach" | "assistant_coach" | "manager";

export const ROLE_LABELS: Record<TeamRoleValue, string> = {
  player: "Player",
  coach: "Coach",
  assistant_coach: "Assistant coach",
  manager: "Manager",
};

export type MemberRow = {
  id: string;
  personId: string;
  name: string;
  role: TeamRoleValue;
  shirtNumber: number | null;
  joinedAt: string;
  /** `is_minor()` — a boolean, never the date behind it. */
  isMinor: boolean;
  /** Short-lived signed URL from `signPeoplePhotos`; null falls back to initials. */
  photoUrl: string | null;
  /** "Mary · 07700 900001 · Mother" lines — only what the reader's policies returned. */
  emergencyContacts: string[];
};

/**
 * The next match and what each player said about it.
 *
 * Staff and administrators only, and the page enforces that: a parent's client
 * returns only their own household's `availability` rows, and a partial read
 * shown as a squad status would lie. Null here means "no fixture ahead" or
 * "not this reader's to see", and the card simply omits the row.
 */
export type SquadAvailability = {
  /** "Sat 29 Aug, 09:30" — printed once, above the grid. */
  fixtureLabel: string;
  /** "Saturday" — the row label on each card. */
  dayLabel: string;
  /** person_id → the answer, or null where nobody has answered. */
  statusByPerson: Record<string, AvailabilityStatus>;
};

/**
 * The newest subscription per player. Loaded ONLY for a committee reader (the
 * same admin-client read the Subs tab does); null for everyone else, and the
 * row is then not rendered at all rather than rendered empty.
 */
export type SquadSubs = { byPerson: Record<string, SquadSub> };

/**
 * "This player has left" (Adam, 2026-08-25) — the coach's half of the squad
 * edit, and the only half they have.
 *
 * `canRequest` is the team's staff who are NOT a club administrator: an admin
 * has End, which does the thing immediately, so offering them the queue as
 * well would only be a slower End. `pendingMembershipIds` are the rows already
 * on the administrator's desk, which is what the card says instead of offering
 * the button a second time.
 */
export type SquadLeave = {
  canRequest: boolean;
  pendingMembershipIds: string[];
};

export type PendingRow = {
  id: number;
  personId: string;
  personName: string;
  role: string | null;
  displayName: string | null;
  createdAt: string;
  attempts: number;
  lastError: string | null;
};

/** How many cards a group shows before "Show the other N". */
const CARD_LIMIT = 11;

/** The design's colour-coded values, in the app's own palette. */
const TONE_CLASS: Record<SquadTone, string> = {
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-destructive",
  plain: "text-foreground",
};

function Feedback({ state }: { state: MembershipActionState }) {
  if (state.error) {
    return (
      <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {state.notice}
      </p>
    );
  }
  return null;
}

/**
 * One card's "this player has left": a button that opens a small confirm form
 * with an optional note, and nothing else. Its own component so each card
 * keeps its own action state — a refusal on one player must not appear under
 * another.
 */
function LeaveRequestForm({
  teamId,
  membershipId,
  name,
}: {
  teamId: string;
  membershipId: string;
  name: string;
}) {
  const [state, action, sending] = useActionState(requestMemberLeave, EMPTY);

  if (state.notice) {
    return <p className="text-xs text-emerald-700">{state.notice}</p>;
  }

  return (
    <details className="group">
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center text-xs text-muted-foreground underline underline-offset-2 lg:min-h-0">
        This player has left
      </summary>
      <form action={action} className="mt-2 space-y-2 rounded-lg border border-dashed p-3">
        <input type="hidden" name="team_id" value={teamId} />
        <input type="hidden" name="membership_id" value={membershipId} />
        <p className="text-xs text-muted-foreground">
          This asks a club administrator to remove {name} from the squad. Nothing changes until they
          approve it.
        </p>
        <Input
          name="note"
          placeholder="Anything the club should know (optional)"
          aria-label={`Why ${name} has left`}
          className="h-11 text-xs lg:h-8"
        />
        <Button type="submit" size="sm" variant="outline" disabled={sending} className="h-11 px-3 text-xs lg:h-8">
          {sending ? "Sending…" : "Send for approval"}
        </Button>
        {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      </form>
    </details>
  );
}

/** "Leaving — awaiting admin": the row already on the administrator's desk. */
function LeavePendingBadge() {
  return <Badge variant="warning">Leaving — awaiting admin</Badge>;
}

/** One label/value line inside a card. */
function CardRow({ label, cell }: { label: string; cell: SquadCell }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`truncate font-semibold ${TONE_CLASS[cell.tone]}`}>{cell.label}</dd>
    </div>
  );
}

/** The filter chips: a count you can click, keyboard-reachable and 44px tall. */
function FilterChip({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "neutral" | "warn";
  onClick: () => void;
  children: ReactNode;
}) {
  const resting =
    tone === "warn" ? "bg-amber-100 text-amber-800 hover:bg-amber-200" : "bg-muted hover:bg-muted/70";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-[44px] items-center rounded-full px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:min-h-0 lg:py-1.5 ${
        active ? "bg-foreground text-background" : resting
      }`}
    >
      {children}
    </button>
  );
}

function MemberCard({
  member,
  teamId,
  canEdit,
  roleValues,
  roleAction,
  shirtAction,
  endAction,
  leavePending,
  canRequestLeave,
  availability,
  dayLabel,
  sub,
  showSubs,
  ageGroup,
}: {
  member: MemberRow;
  teamId: string;
  canEdit: boolean;
  roleValues: TeamRoleValue[];
  roleAction: (formData: FormData) => void;
  shirtAction: (formData: FormData) => void;
  endAction: (formData: FormData) => void;
  leavePending: boolean;
  canRequestLeave: boolean;
  availability: AvailabilityStatus | undefined;
  dayLabel: string | null;
  sub: SquadSub | undefined;
  showSubs: boolean;
  ageGroup: string | null;
}) {
  const isPlayer = member.role === "player";
  const noContact = isPlayer && member.emergencyContacts.length === 0;
  const silent = availability === null;
  // The design tints the border of a card that needs something. Nobody to ring
  // is the graver of the two, so it takes the red; an unanswered match is amber.
  const border = noContact
    ? "border-destructive/30"
    : silent
      ? "border-amber-400/60"
      : "border-border";
  const ring = noContact
    ? "ring-2 ring-destructive/20"
    : silent
      ? "ring-2 ring-amber-300"
      : "";

  // "Under 18 · #7 · U12" — the role, and only facts the club actually holds.
  const meta = [
    ROLE_LABELS[member.role],
    member.shirtNumber !== null ? `#${member.shirtNumber}` : null,
    isPlayer ? ageGroup : null,
    member.isMinor ? "Under 18" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className={`flex flex-col rounded-lg border ${border} bg-card p-3.5`}>
      <div className="flex items-center gap-2.5">
        <Avatar name={member.name} photoUrl={member.photoUrl} size="md" className={ring} />
        <div className="min-w-0">
          <Link
            href={`/people/${member.personId}`}
            className="block truncate text-sm font-semibold underline-offset-2 hover:underline"
          >
            {member.name}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 text-xs">
        {availability !== undefined && dayLabel ? (
          <CardRow label={dayLabel} cell={availabilityCell(availability)} />
        ) : null}
        {showSubs && isPlayer ? <CardRow label="Subs" cell={subsCell(sub)} /> : null}
        <CardRow label="Joined" cell={{ label: formatStamp(member.joinedAt), tone: "plain" }} />
      </dl>

      <div className="mt-3 border-t pt-2.5 text-xs">
        {member.emergencyContacts.length > 0 ? (
          <p className="text-muted-foreground">{member.emergencyContacts.join(" · ")}</p>
        ) : noContact ? (
          <p className="font-medium text-amber-700">No emergency contact on record</p>
        ) : (
          <p className="text-muted-foreground">No emergency contact recorded</p>
        )}
        {leavePending ? (
          <div className="mt-2">
            <LeavePendingBadge />
          </div>
        ) : null}
      </div>

      {canEdit || (canRequestLeave && !leavePending) ? (
        <details className="mt-1">
          <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center text-xs font-medium text-muted-foreground underline underline-offset-2 lg:min-h-0 lg:py-1">
            Manage
          </summary>
          <div className="mt-2 space-y-2">
            {canEdit ? (
              <>
                <form action={roleAction} className="flex items-center gap-2">
                  <input type="hidden" name="team_id" value={teamId} />
                  <input type="hidden" name="membership_id" value={member.id} />
                  <Select
                    name="role"
                    defaultValue={member.role}
                    aria-label={`Role for ${member.name}`}
                    className="h-11 flex-1 text-xs lg:h-9"
                  >
                    {roleValues.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    className="h-11 px-3 text-xs lg:h-9"
                  >
                    Save
                  </Button>
                </form>
                <div className="flex items-center gap-2">
                  <form action={shirtAction} className="flex flex-1 items-center gap-2">
                    <input type="hidden" name="team_id" value={teamId} />
                    <input type="hidden" name="membership_id" value={member.id} />
                    <Input
                      name="shirt_number"
                      type="number"
                      min={0}
                      max={99}
                      defaultValue={member.shirtNumber ?? ""}
                      aria-label={`Shirt number for ${member.name}`}
                      placeholder="Shirt"
                      className="h-11 w-20 px-2 text-xs lg:h-9"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="h-11 px-3 text-xs lg:h-9"
                    >
                      Save
                    </Button>
                  </form>
                  {/* End is immediate and club_admin's alone. Everyone else on
                      the team's staff asks instead. */}
                  <form
                    action={endAction}
                    onSubmit={(event) => {
                      const ok = window.confirm(
                        `End the membership of ${member.name}? The record is kept, not deleted.`,
                      );
                      if (!ok) event.preventDefault();
                    }}
                  >
                    <input type="hidden" name="team_id" value={teamId} />
                    <input type="hidden" name="membership_id" value={member.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="h-11 px-3 text-xs lg:h-9"
                    >
                      End
                    </Button>
                  </form>
                </div>
              </>
            ) : null}
            {canRequestLeave && !leavePending ? (
              <LeaveRequestForm teamId={teamId} membershipId={member.id} name={member.name} />
            ) : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}

export function MembersPanel({
  teamId,
  seasonId,
  seasonName,
  members,
  pending,
  canEdit,
  squadLeave,
  availability,
  subs,
  ageGroup,
}: {
  teamId: string;
  seasonId: string | null;
  seasonName: string | null;
  members: MemberRow[];
  pending: PendingRow[];
  canEdit: boolean;
  squadLeave: SquadLeave;
  availability: SquadAvailability | null;
  subs: SquadSubs | null;
  ageGroup: string | null;
}) {
  const [addState, addAction, adding] = useActionState(addTeamMember, EMPTY);
  const [roleState, roleAction] = useActionState(changeMemberRole, EMPTY);
  const [shirtState, shirtAction] = useActionState(setShirtNumber, EMPTY);
  const [endState, endAction] = useActionState(endMembership, EMPTY);
  const [filter, setFilter] = useState<SquadFilter>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const alreadyIn = members.map((m) => m.personId);
  // Adam, 2026-08-25: "Managers and coaches should be split from players in
  // the squad screen." One list becomes two, in the order a team sheet is
  // read: the people running it, then the people playing.
  const staffMembers = members.filter((m) => m.role !== "player");
  const playerMembers = members.filter((m) => m.role === "player");
  const groups: { key: string; heading: string; rows: MemberRow[]; empty: string }[] = [
    {
      key: "staff",
      heading: "Coaches and managers",
      rows: staffMembers,
      empty: "No coaches or managers recorded for this team.",
    },
    {
      key: "players",
      heading: "Players",
      rows: playerMembers,
      empty: "No players recorded for this team.",
    },
  ];
  const roleValues = Object.keys(ROLE_LABELS) as TeamRoleValue[];
  const leavePending = new Set(squadLeave.pendingMembershipIds);

  // The chips count the squad — the players. A coach does not answer a
  // fixture and is not the person the club rings about a child, so counting
  // them would only make both numbers wrong.
  const facts = new Map<string, SquadCardFacts>(
    playerMembers.map((member) => [
      member.id,
      {
        personId: member.personId,
        hasEmergencyContact: member.emergencyContacts.length > 0,
        // undefined where the question was never asked (no fixture ahead).
        availability: availability
          ? (availability.statusByPerson[member.personId] ?? null)
          : undefined,
      } satisfies SquadCardFacts,
    ]),
  );
  const counts = squadCounts(Array.from(facts.values()));
  const visibleRows = (rows: MemberRow[]): MemberRow[] => {
    if (filter === "all") return rows;
    return rows.filter((member) => {
      const fact = facts.get(member.id);
      return fact ? matchesFilter(fact, filter) : false;
    });
  };

  return (
    <div className="space-y-6">
      {!seasonId && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No season is marked current, so this team has no roster to show. Make one current on the
          Teams screen.
        </p>
      )}

      <div>
        <p className="text-xs uppercase text-muted-foreground">
          {seasonName ? `Season ${seasonName}` : "Current season"}
        </p>
        {members.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nobody is recorded in this team for the current season.
          </p>
        ) : (
          <>
            {/* The chip strip: three counts you can click, and the date the
                availability column is speaking about. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <FilterChip active={filter === "all"} tone="neutral" onClick={() => setFilter("all")}>
                All {counts.all} {counts.all === 1 ? "player" : "players"}
              </FilterChip>
              <FilterChip
                active={filter === "chasing"}
                tone="warn"
                onClick={() => setFilter(filter === "chasing" ? "all" : "chasing")}
              >
                Needs chasing {counts.chasing}
              </FilterChip>
              <FilterChip
                active={filter === "no-contact"}
                tone="neutral"
                onClick={() => setFilter(filter === "no-contact" ? "all" : "no-contact")}
              >
                No emergency contact {counts.noContact}
              </FilterChip>
              {availability ? (
                <span className="text-xs text-muted-foreground sm:ml-auto">
                  Availability shown for {availability.fixtureLabel}
                </span>
              ) : null}
            </div>

            {groups.map((group) => {
              const rows = visibleRows(group.rows);
              // The design's last cell is a dashed "Show the other N". A group
              // only one card over the limit is drawn whole instead — hiding a
              // single card behind a button would be sillier than showing it.
              const open = expanded[group.key] === true;
              const capped = !open && rows.length > CARD_LIMIT + 1;
              const shown = capped ? rows.slice(0, CARD_LIMIT) : rows;
              const hidden = rows.length - shown.length;
              return (
                <div key={group.key} className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.heading}
                  </p>
                  {group.rows.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">{group.empty}</p>
                  ) : rows.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">
                      Nobody in this group matches that filter.
                    </p>
                  ) : (
                    <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {shown.map((member) => (
                        <MemberCard
                          key={member.id}
                          member={member}
                          teamId={teamId}
                          canEdit={canEdit}
                          roleValues={roleValues}
                          roleAction={roleAction}
                          shirtAction={shirtAction}
                          endAction={endAction}
                          leavePending={leavePending.has(member.id)}
                          canRequestLeave={squadLeave.canRequest}
                          availability={
                            availability && member.role === "player"
                              ? (availability.statusByPerson[member.personId] ?? null)
                              : undefined
                          }
                          dayLabel={availability?.dayLabel ?? null}
                          sub={subs?.byPerson[member.personId]}
                          showSubs={subs !== null}
                          ageGroup={ageGroup}
                        />
                      ))}
                      {hidden > 0 ? (
                        <li>
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((prev) => ({ ...prev, [group.key]: true }))
                            }
                            className="flex h-full min-h-[96px] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3.5 text-center transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <span className="text-sm font-semibold text-primary">
                              Show the other {hidden}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {rows.length} in {group.heading.toLowerCase()}
                            </span>
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  )}
                </div>
              );
            })}
          </>
        )}
        <div className="mt-2 space-y-2">
          <Feedback state={roleState} />
          <Feedback state={shirtState} />
          <Feedback state={endState} />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Waiting for date of birth                                          */}
      {/* ------------------------------------------------------------------ */}
      {pending.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <Clock className="h-4 w-4" /> Waiting for date of birth
          </p>
          <p className="mt-1 text-xs text-amber-900/80">
            These memberships came across from the pitch-booking app but cannot be applied yet. An
            unknown date of birth counts as a minor (SG-0), and a &ldquo;minor&rdquo; coach would
            block every child added to the team afterwards — so the import waits. Open the person,
            record their date of birth, and the queued membership is applied straight away.
          </p>
          <ul className="mt-3 space-y-2">
            {pending.map((row) => (
              <li key={row.id} className="text-sm">
                <Link
                  href={`/people/${row.personId}`}
                  className="font-medium underline underline-offset-2"
                >
                  {row.personName}
                </Link>
                <span className="text-muted-foreground">
                  {row.role ? ` · ${row.role}` : ""}
                  {row.displayName ? ` · ${row.displayName}` : ""}
                  {` · queued ${formatStamp(row.createdAt)}`}
                  {row.attempts > 0
                    ? ` · ${row.attempts} attempt${row.attempts === 1 ? "" : "s"}`
                    : ""}
                </span>
                {row.lastError && (
                  <p className="flex items-start gap-1 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {row.lastError}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Add a member                                                       */}
      {/* ------------------------------------------------------------------ */}
      {canEdit ? (
        <form action={addAction} className="space-y-4 rounded-lg border border-dashed p-4">
          <p className="text-sm font-medium">Add a member</p>
          <input type="hidden" name="team_id" value={teamId} />
          <input type="hidden" name="season_id" value={seasonId ?? ""} />
          <PersonPicker
            id="add-member-person"
            name="person_id"
            label="Person"
            excludeIds={alreadyIn}
            required
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-member-role">Role</Label>
              <Select id="add-member-role" name="role" defaultValue="player">
                {roleValues.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-member-shirt">Shirt number</Label>
              <Input id="add-member-shirt" name="shirt_number" type="number" min={0} max={99} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-member-joined">Joined on</Label>
              <Input id="add-member-joined" name="joined_at" type="date" defaultValue={todayIso()} />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={adding || !seasonId}>
            {adding ? "Adding…" : "Add to team"}
          </Button>
          <Feedback state={addState} />
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          Read-only. Only a club administrator can change who is in a team.
        </p>
      )}
    </div>
  );
}
