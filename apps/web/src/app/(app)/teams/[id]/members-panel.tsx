"use client";

/**
 * Everyone in the team this season — players included — with the paperwork
 * badge for the child-facing roles and, for a club administrator, the four
 * edits the club actually needs: add, change role, change shirt number, end.
 *
 * A refusal from the database is shown as it arrived. The SG-6 trigger's
 * message names the person and the certification that is missing, which is
 * exactly the sentence the administrator needs; rewriting it would throw that
 * away.
 *
 * Dates of birth are deliberately absent. The server sends a minor flag (from
 * `is_minor()`, which returns a boolean and nothing else); the date itself
 * belongs to the person's own record, behind the People screens.
 */

import Link from "next/link";
import { useActionState } from "react";
import { AlertTriangle, Clock } from "lucide-react";

import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { PersonPicker } from "@/components/person-picker";
import { formatStamp, todayIso } from "@/lib/people-display";

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
  /** Whether this role is one the SG-6 lookup calls child-facing. */
  childFacing: boolean;
  /** `person_compliance_status()` for the two SG-6 certifications, null for a player. */
  dbs: string | null;
  safeguarding: string | null;
  /** Short-lived signed URL from `signPeoplePhotos`; null falls back to initials. */
  photoUrl: string | null;
};

/**
 * "This player has left" (Adam, 2026-08-25) — the coach's half of the squad
 * edit, and the only half they have.
 *
 * `canRequest` is the team's staff who are NOT a club administrator: an admin
 * has End, which does the thing immediately, so offering them the queue as
 * well would only be a slower End. `pendingMembershipIds` are the rows already
 * on the administrator's desk, which is what the row says instead of offering
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

function complianceVariant(status: string): "success" | "warning" | "destructive" | "muted" {
  if (status === "valid") return "success";
  if (status === "expiring") return "warning";
  if (status === "expired") return "destructive";
  return "muted";
}

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
 * One row's "this player has left": a button that opens a small confirm form
 * with an optional note, and nothing else. Its own component so each row keeps
 * its own action state — a refusal on one player must not appear under another.
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

export function MembersPanel({
  teamId,
  seasonId,
  seasonName,
  members,
  pending,
  canEdit,
  squadLeave,
}: {
  teamId: string;
  seasonId: string | null;
  seasonName: string | null;
  members: MemberRow[];
  pending: PendingRow[];
  canEdit: boolean;
  squadLeave: SquadLeave;
}) {
  const [addState, addAction, adding] = useActionState(addTeamMember, EMPTY);
  const [roleState, roleAction] = useActionState(changeMemberRole, EMPTY);
  const [shirtState, shirtAction] = useActionState(setShirtNumber, EMPTY);
  const [endState, endAction] = useActionState(endMembership, EMPTY);

  const alreadyIn = members.map((m) => m.personId);
  // Adam, 2026-08-25: "Managers and coaches should be split from players in
  // the squad screen." One list becomes two, in the order a team sheet is
  // read: the people running it, then the people playing. Everything else —
  // the cards on a phone, the table on the desk, the controls — is the same
  // component rendered twice.
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
          {groups.map((group) => (
            <div key={group.key} className="mt-4 first:mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.heading}
              </p>
              {group.rows.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">{group.empty}</p>
              ) : (
                <>
          {/* The phone reads the roster as cards, one member each, with the
              same four edits stacked underneath (mobile design). */}
          <ul className="mt-2 divide-y rounded-lg border lg:hidden">
            {group.rows.map((member) => (
              <li key={member.id} className="space-y-2.5 px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={member.name} photoUrl={member.photoUrl} size="md" />
                    <div className="min-w-0">
                      <Link
                        href={`/people/${member.personId}`}
                        className="block truncate font-medium underline underline-offset-2"
                      >
                        {member.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {ROLE_LABELS[member.role]}
                        {member.shirtNumber !== null ? ` · #${member.shirtNumber}` : ""}
                        {` · joined ${formatStamp(member.joinedAt)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-none flex-col items-end gap-1">
                    {member.isMinor && <Badge variant="warning">Minor</Badge>}
                    {leavePending.has(member.id) ? <LeavePendingBadge /> : null}
                  </div>
                </div>

                {member.childFacing ? (
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={complianceVariant(member.dbs ?? "missing")}>
                      DBS: {member.dbs ?? "missing"}
                    </Badge>
                    <Badge variant={complianceVariant(member.safeguarding ?? "missing")}>
                      Safeguarding: {member.safeguarding ?? "missing"}
                    </Badge>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Not child-facing</p>
                )}

                {canEdit && (
                  <div className="space-y-2">
                    <form action={roleAction} className="flex items-center gap-2">
                      <input type="hidden" name="team_id" value={teamId} />
                      <input type="hidden" name="membership_id" value={member.id} />
                      <Select
                        name="role"
                        defaultValue={member.role}
                        aria-label={`Role for ${member.name}`}
                        className="h-11 flex-1 text-xs"
                      >
                        {roleValues.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" size="sm" variant="outline" className="h-11 px-3 text-xs">
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
                          className="h-11 w-20 px-2 text-xs"
                        />
                        <Button type="submit" size="sm" variant="outline" className="h-11 px-3 text-xs">
                          Save
                        </Button>
                      </form>
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
                        <Button type="submit" size="sm" variant="outline" className="h-11 px-3 text-xs">
                          End
                        </Button>
                      </form>
                    </div>
                  </div>
                )}

                {squadLeave.canRequest && !leavePending.has(member.id) ? (
                  <LeaveRequestForm teamId={teamId} membershipId={member.id} name={member.name} />
                ) : null}
              </li>
            ))}
          </ul>

          <div className="mt-2 hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Member</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Shirt</th>
                  <th className="py-2 pr-3 font-medium">Joined</th>
                  <th className="py-2 pr-3 font-medium">Safeguarding</th>
                  {canEdit || squadLeave.canRequest ? (
                    <th className="py-2 font-medium">Actions</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((member) => (
                  <tr key={member.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={member.name} photoUrl={member.photoUrl} size="sm" />
                        <div className="min-w-0">
                          <Link
                            href={`/people/${member.personId}`}
                            className="font-medium underline underline-offset-2"
                          >
                            {member.name}
                          </Link>
                          {member.isMinor && (
                            <Badge variant="warning" className="ml-2">
                              Minor
                            </Badge>
                          )}
                          {leavePending.has(member.id) ? (
                            <div className="mt-1">
                              <LeavePendingBadge />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {canEdit ? (
                        <form action={roleAction} className="flex items-center gap-1">
                          <input type="hidden" name="team_id" value={teamId} />
                          <input type="hidden" name="membership_id" value={member.id} />
                          <Select
                            name="role"
                            defaultValue={member.role}
                            aria-label={`Role for ${member.name}`}
                            className="h-8 w-40 text-xs"
                          >
                            {roleValues.map((role) => (
                              <option key={role} value={role}>
                                {ROLE_LABELS[role]}
                              </option>
                            ))}
                          </Select>
                          <Button type="submit" size="sm" variant="outline" className="h-8 px-2 text-xs">
                            Save
                          </Button>
                        </form>
                      ) : (
                        ROLE_LABELS[member.role]
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {canEdit ? (
                        <form action={shirtAction} className="flex items-center gap-1">
                          <input type="hidden" name="team_id" value={teamId} />
                          <input type="hidden" name="membership_id" value={member.id} />
                          <Input
                            name="shirt_number"
                            type="number"
                            min={0}
                            max={99}
                            defaultValue={member.shirtNumber ?? ""}
                            aria-label={`Shirt number for ${member.name}`}
                            className="h-8 w-16 px-2 text-xs"
                          />
                          <Button type="submit" size="sm" variant="outline" className="h-8 px-2 text-xs">
                            Save
                          </Button>
                        </form>
                      ) : (
                        (member.shirtNumber ?? "—")
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">{formatStamp(member.joinedAt)}</td>
                    <td className="py-2 pr-3">
                      {member.childFacing ? (
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={complianceVariant(member.dbs ?? "missing")}>
                            DBS: {member.dbs ?? "missing"}
                          </Badge>
                          <Badge variant={complianceVariant(member.safeguarding ?? "missing")}>
                            Safeguarding: {member.safeguarding ?? "missing"}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not child-facing</span>
                      )}
                    </td>
                    {canEdit || squadLeave.canRequest ? (
                      <td className="py-2">
                        {/* End is immediate and club_admin's alone. Everyone
                            else on the team's staff asks instead. */}
                        {canEdit ? (
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
                            <Button type="submit" size="sm" variant="outline" className="h-8 px-2 text-xs">
                              End
                            </Button>
                          </form>
                        ) : null}
                        {squadLeave.canRequest && !leavePending.has(member.id) ? (
                          <LeaveRequestForm
                            teamId={teamId}
                            membershipId={member.id}
                            name={member.name}
                          />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
                </>
              )}
            </div>
          ))}
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
