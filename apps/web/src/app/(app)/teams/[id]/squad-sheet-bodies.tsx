import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { formatStamp } from "@/lib/people-display";
import { availabilityCell, subsCell, type AvailabilityStatus, type SquadSub } from "@/lib/squad-cards";

import { MemberManageForms, ROLE_LABELS, type MemberRow } from "./members-panel";

/**
 * What the squad's `PersonSheet` shows, one mode at a time (P8.7a).
 *
 * `page.tsx` does the reading; this file does the drawing. A plain server
 * module, NOT `"use client"` — it composes the client forms that hold the
 * server actions, and every one of those keeps the action it always had.
 *
 * Nothing here is read from the database. Every value on these three panels
 * was already in hand for the roster row the reader pressed: the name, the
 * role, the shirt, the minor flag, the next match's answer, the newest
 * subscription (committee only) and the emergency contacts the reader's own
 * policies returned. Opening somebody costs no round trip, which is why the
 * roster can stay a list and still say everything the cards used to.
 *
 * `canEdit` and `canRequestLeave` are the SCREEN's answers, computed in
 * `page.tsx` from the hat and handed down. They are never worked out here.
 */

export type SquadSheetData = {
  teamId: string;
  teamName: string;
  ageGroup: string | null;
  seasonName: string | null;
  member: MemberRow;
  /** A club administrator, wearing the admin hat: role, shirt and End. */
  canEdit: boolean;
  /** The team's own staff, who ask rather than do. */
  canRequestLeave: boolean;
  /** Already on the administrator's desk — say so instead of asking twice. */
  leavePending: boolean;
  /** The next match's answer, or undefined where the question was not asked. */
  availability: AvailabilityStatus | undefined;
  /** "Sat 29 Aug, 09:30" — what the availability is about. */
  fixtureLabel: string | null;
  /** The newest subscription; undefined for a reader who is not committee. */
  sub: SquadSub | undefined;
  /** Whether subs were loaded at all — absent means "not this reader's". */
  showSubs: boolean;
};

/** The three tones `lib/squad-cards` speaks, in the app's own tokens. */
const TONE_INK = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  plain: "text-foreground",
} as const;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

export function SquadSheetBody({
  mode,
  data,
}: {
  mode: "details" | "contacts" | "membership";
  data: SquadSheetData;
}): ReactNode {
  const { member } = data;
  const isPlayer = member.role === "player";

  if (mode === "details") {
    const answer = data.availability !== undefined ? availabilityCell(data.availability) : null;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={member.name} photoUrl={member.photoUrl} size="md" />
          <div className="min-w-0">
            <Link
              href={`/people/${member.personId}`}
              className="touch flex items-center truncate text-row font-semibold underline-offset-2 hover:underline"
            >
              {member.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {[
                ROLE_LABELS[member.role],
                member.shirtNumber !== null ? `#${member.shirtNumber}` : null,
                isPlayer ? data.ageGroup : null,
                member.isMinor ? "Under 18" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        <dl>
          {answer && data.fixtureLabel ? (
            <Fact label={data.fixtureLabel}>
              <span className={TONE_INK[answer.tone]}>{answer.label}</span>
            </Fact>
          ) : null}
          {data.showSubs && isPlayer ? (
            <Fact label="Subs">
              <span className={TONE_INK[subsCell(data.sub).tone]}>{subsCell(data.sub).label}</span>
            </Fact>
          ) : null}
          <Fact label="Joined">{formatStamp(member.joinedAt)}</Fact>
        </dl>

        <MemberManageForms
          teamId={data.teamId}
          member={member}
          canEdit={data.canEdit}
          canRequestLeave={data.canRequestLeave}
          leavePending={data.leavePending}
        />
      </div>
    );
  }

  if (mode === "contacts") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The people the club rings if something happens at training or on a match day. They are
          held on {member.name}&apos;s own record, not on this team — a club administrator changes
          them there, and the person and their guardians change them from their own screens.
        </p>
        {member.emergencyContacts.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {member.emergencyContacts.map((line) => (
              <li key={line} className="rounded-lg border px-3 py-2">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className={`text-sm font-medium ${isPlayer ? "text-warning" : "text-muted-foreground"}`}>
            {isPlayer
              ? "No emergency contact on record — there is nobody to ring."
              : "No emergency contact recorded."}
          </p>
        )}
        <Link
          href={`/people/${member.personId}?sheet=contacts`}
          className="touch inline-flex items-center text-sm font-medium text-primary underline underline-offset-2"
        >
          Open {member.name}&apos;s record to change them
        </Link>
      </div>
    );
  }

  // membership
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Where {member.name} stands in {data.teamName} this season. Memberships end; they are never
        deleted, so a player who leaves keeps their history with the team.
      </p>
      <dl>
        <Fact label="Season">{data.seasonName ?? "Current season"}</Fact>
        <Fact label="Role">{ROLE_LABELS[member.role]}</Fact>
        <Fact label="Shirt">{member.shirtNumber !== null ? `#${member.shirtNumber}` : "Not set"}</Fact>
        <Fact label="Joined">{formatStamp(member.joinedAt)}</Fact>
        <Fact label="Status">
          {data.leavePending ? (
            <Badge variant="warning">Leaving — awaiting admin</Badge>
          ) : (
            <Badge variant="success">In the squad</Badge>
          )}
        </Fact>
      </dl>
      <Link
        href={`/people/${member.personId}?sheet=membership`}
        className="touch inline-flex items-center text-sm font-medium text-primary underline underline-offset-2"
      >
        The club membership behind this — number, household and family
      </Link>
    </div>
  );
}
