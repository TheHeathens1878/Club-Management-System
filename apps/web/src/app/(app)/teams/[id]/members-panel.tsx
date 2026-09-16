"use client";

/**
 * What is left of the squad panel once the roster became a list and the
 * detail became a sheet (P8.7a).
 *
 * The Squad tab used to be a grid of cards, each card carrying its own
 * "Manage" disclosure with four forms inside it — so a team of eighteen drew
 * seventy-two forms nobody had asked for, and the two facts a coach opens the
 * tab to read were three scrolls apart. Now the roster is one `DataListFrame`
 * (server-rendered cells, filterable columns, a phone twin) and everything
 * you CHANGE opens in `PersonSheet` over it, addressed by `?sheet=&person=`.
 *
 * This file keeps the two things that must stay client-side: the forms
 * themselves. Every server action is the one it always was —
 * `changeMemberRole`, `setShirtNumber`, `endMembership`,
 * `requestMemberLeave`, `addTeamMember` — with the same fields, so the
 * database still decides and a refusal is still shown in its own words.
 *
 * Dates of birth are deliberately absent, as they always were: the server
 * sends a minor flag from `is_minor()` and the date itself belongs to the
 * person's own record behind /people.
 */

import Link from "next/link";
import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { PersonPicker } from "@/components/person-picker";
import { formatStamp, todayIso } from "@/lib/people-display";
import type { AvailabilityStatus, SquadSub } from "@/lib/squad-cards";

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

export const ROLE_VALUES = Object.keys(ROLE_LABELS) as TeamRoleValue[];

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
 * "not this reader's to see", and the column is simply not drawn.
 */
export type SquadAvailability = {
  /** "Sat 29 Aug, 09:30" — printed once, above the list. */
  fixtureLabel: string;
  /** "Saturday" — the column heading. */
  dayLabel: string;
  /** person_id → the answer, or null where nobody has answered. */
  statusByPerson: Record<string, AvailabilityStatus>;
};

/**
 * The newest subscription per player. Loaded ONLY for a committee reader (the
 * same admin-client read the Subs tab does); null for everyone else, and the
 * column is then not rendered at all rather than rendered empty.
 */
export type SquadSubs = { byPerson: Record<string, SquadSub> };

/**
 * "This player has left" (Adam, 2026-08-25) — the coach's half of the squad
 * edit, and the only half they have.
 *
 * `canRequest` is the team's staff who are NOT a club administrator: an admin
 * has End, which does the thing immediately, so offering them the queue as
 * well would only be a slower End. `pendingMembershipIds` are the rows already
 * on the administrator's desk, which is what the sheet says instead of
 * offering the button a second time.
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

/** A refusal, or a confirmation, in the database's own words. */
function Feedback({ state }: { state: MembershipActionState }) {
  if (state.error) {
    return (
      <Callout tone="danger">
        <span className="whitespace-pre-line">{state.error}</span>
      </Callout>
    );
  }
  if (state.notice) return <Callout tone="success">{state.notice}</Callout>;
  return null;
}

/**
 * "This player has left": a small form with an optional note, and nothing
 * else. Its own component so it keeps its own action state — a refusal about
 * one player must never appear under another.
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

  if (state.notice) return <Callout tone="success">{state.notice}</Callout>;

  return (
    <form action={action} className="space-y-2 rounded-lg border border-dashed p-3">
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
        className="touch text-sm"
      />
      <Button type="submit" size="touch" variant="outline" disabled={sending}>
        {sending ? "Sending…" : "This player has left"}
      </Button>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

/**
 * One member's place in this team, as the three forms that change it. Drawn
 * inside `PersonSheet`, so every control carries `touch`: the sheet's own
 * fields are measured at 390 like everything else on the page.
 *
 * `canEdit` is the SCREEN's answer, handed down from `page.tsx`; it is never
 * worked out here. Each action re-checks the caller for itself and RLS has
 * the last word.
 */
export function MemberManageForms({
  teamId,
  member,
  canEdit,
  canRequestLeave,
  leavePending,
}: {
  teamId: string;
  member: MemberRow;
  canEdit: boolean;
  canRequestLeave: boolean;
  leavePending: boolean;
}) {
  const [roleState, roleAction] = useActionState(changeMemberRole, EMPTY);
  const [shirtState, shirtAction] = useActionState(setShirtNumber, EMPTY);
  const [endState, endAction] = useActionState(endMembership, EMPTY);

  if (!canEdit && !canRequestLeave) {
    return (
      <p className="text-sm text-muted-foreground">
        Read-only. Only a club administrator can change who is in a team.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <>
          <form action={roleAction} className="space-y-1.5">
            <Label htmlFor={`role-${member.id}`}>Role in this team</Label>
            <div className="flex items-end gap-2">
              <input type="hidden" name="team_id" value={teamId} />
              <input type="hidden" name="membership_id" value={member.id} />
              <Select
                id={`role-${member.id}`}
                name="role"
                defaultValue={member.role}
                className="touch min-w-0 flex-1"
              >
                {ROLE_VALUES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="touch" variant="outline">
                Save
              </Button>
            </div>
            <Feedback state={roleState} />
          </form>

          <form action={shirtAction} className="space-y-1.5">
            <Label htmlFor={`shirt-${member.id}`}>Shirt number</Label>
            <div className="flex items-end gap-2">
              <input type="hidden" name="team_id" value={teamId} />
              <input type="hidden" name="membership_id" value={member.id} />
              <Input
                id={`shirt-${member.id}`}
                name="shirt_number"
                type="number"
                min={0}
                max={99}
                defaultValue={member.shirtNumber ?? ""}
                placeholder="Shirt"
                className="touch w-24"
              />
              <Button type="submit" size="touch" variant="outline">
                Save
              </Button>
            </div>
            <Feedback state={shirtState} />
          </form>

          {/* End is immediate and a club administrator's alone. Everyone else
              on the team's staff asks instead, on the form below. */}
          <form
            action={endAction}
            className="space-y-1.5 rounded-lg border border-destructive/20 p-3"
            onSubmit={(event) => {
              const ok = window.confirm(
                `End the membership of ${member.name}? The record is kept, not deleted.`,
              );
              if (!ok) event.preventDefault();
            }}
          >
            <input type="hidden" name="team_id" value={teamId} />
            <input type="hidden" name="membership_id" value={member.id} />
            <p className="text-xs text-muted-foreground">
              Memberships end; they are never deleted. {member.name} keeps their record and their
              history with this team.
            </p>
            <Button type="submit" size="touch" variant="outline">
              End this membership
            </Button>
            <Feedback state={endState} />
          </form>
        </>
      ) : null}

      {leavePending ? (
        <Badge variant="warning">Leaving — awaiting admin</Badge>
      ) : canRequestLeave ? (
        <LeaveRequestForm teamId={teamId} membershipId={member.id} name={member.name} />
      ) : null}
    </div>
  );
}

/**
 * Add somebody to the squad. One press at the top of the tab opens it, which
 * is what it was worth: it is the only thing on the Squad tab that makes a
 * row rather than changing one.
 */
export function AddMemberPanel({
  teamId,
  seasonId,
  alreadyIn,
}: {
  teamId: string;
  seasonId: string | null;
  /** Nobody is offered twice — the picker hides the people already on it. */
  alreadyIn: string[];
}) {
  const [state, action, adding] = useActionState(addTeamMember, EMPTY);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="team_id" value={teamId} />
      <input type="hidden" name="season_id" value={seasonId ?? ""} />
      <PersonPicker id="add-member-person" name="person_id" label="Person" excludeIds={alreadyIn} required />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="add-member-role">Role</Label>
          <Select id="add-member-role" name="role" defaultValue="player" className="touch">
            {ROLE_VALUES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-member-shirt">Shirt number</Label>
          <Input id="add-member-shirt" name="shirt_number" type="number" min={0} max={99} className="touch" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-member-joined">Joined on</Label>
          <Input
            id="add-member-joined"
            name="joined_at"
            type="date"
            defaultValue={todayIso()}
            className="touch"
          />
        </div>
      </div>
      <Button type="submit" size="touch" disabled={adding || !seasonId}>
        {adding ? "Adding…" : "Add to team"}
      </Button>
      {!seasonId ? (
        <p className="text-xs text-muted-foreground">
          No season is marked current, so there is no roster to add to. Make one current on the
          Teams screen.
        </p>
      ) : null}
      <Feedback state={state} />
    </form>
  );
}

/**
 * The imports SG-0 is holding back. An unknown date of birth counts as a
 * minor, and a "minor" coach would block every child added to the team
 * afterwards — so the import waits rather than guessing.
 */
export function PendingImportsPanel({ rows }: { rows: PendingRow[] }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        These memberships came across from the pitch-booking app but cannot be applied yet. Open
        the person, record their date of birth, and the queued membership is applied straight away.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="text-sm">
            <Link
              href={`/people/${row.personId}`}
              className="touch inline-flex items-center font-medium underline underline-offset-2"
            >
              {row.personName}
            </Link>
            <span className="text-muted-foreground">
              {row.role ? ` · ${row.role}` : ""}
              {row.displayName ? ` · ${row.displayName}` : ""}
              {` · queued ${formatStamp(row.createdAt)}`}
              {row.attempts > 0 ? ` · ${row.attempts} attempt${row.attempts === 1 ? "" : "s"}` : ""}
            </span>
            {row.lastError && <p className="text-xs text-warning">{row.lastError}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
