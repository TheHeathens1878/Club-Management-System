import Link from "next/link";
import { Clock, Megaphone, UserPlus, Users } from "lucide-react";

import type { Database } from "@club/db";

import { Avatar } from "@/components/avatar";
import { PersonSheet } from "@/components/person/person-sheet";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataListFrame, type DataColumn, type DataItem } from "@/components/ui/data-list";
import { FoldCard } from "@/components/ui/fold-card";
import { StatRow, StatTile } from "@/components/ui/stat-tile";
import type { PersonSheetMode } from "@/lib/person-record-state";
import { availabilityCell, squadCounts, subsCell, type SquadCardFacts } from "@/lib/squad-cards";

import { AddMemberPanel, PendingImportsPanel, ROLE_LABELS } from "./members-panel";
import { RecruitingPanel } from "./recruiting-panel";
import type { SquadTabData } from "./squad-data";
import { SquadSheetBody } from "./squad-sheet-bodies";
import {
  SQUAD_SHEET_CAPTIONS,
  SQUAD_SHEET_LABELS,
  SQUAD_SHEET_MODES,
  type SquadSheetMode,
} from "./squad-sheet-modes";

/**
 * The Squad tab: the roster as one list, and a member opened over it (P8.7a).
 *
 * It used to be a grid of cards, each with a "Manage" disclosure holding four
 * forms — eighteen players meant seventy-two forms rendered before anybody
 * had asked to change anything, and the two facts a coach opens this tab for
 * (who has not answered, who there is nobody to ring for) were spread across
 * four scroll-heights. Now the roster is one `DataListFrame`: a dense table at
 * `lg`, a stack of cards on a phone, filtered once so the two shapes can never
 * disagree, with the columns the reader is entitled to and no others.
 *
 * The cells are rendered HERE, on the server — the avatar, the role, the
 * availability word, the subs pill, the people to ring — and the frame only
 * draws the chrome. So adopting it costs no queries and no round trips.
 *
 * Pressing a row opens `PersonSheet` at `?sheet=details&person=<id>`: the mode
 * is the URL, so a half-finished shirt number survives a refresh, a colleague
 * can be sent the exact panel, and a server action re-rendering the page
 * underneath does not slam it shut.
 *
 * The reads live in `squad-data.ts`; nothing here touches Supabase.
 */

// ---------------------------------------------------------------------------
// What the tab draws
// ---------------------------------------------------------------------------

/** The three tones `lib/squad-cards` speaks, in the app's own tokens. */
const TONE_INK = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  plain: "text-foreground",
} as const;

/** "Open to new players · Just turn up · Under 14s" — or why it is shut. */
function recruitingSummary(team: {
  recruiting: boolean | null;
  join_type: string | null;
  age_group: string | null;
  gender: string | null;
}): string {
  if (!team.recruiting) return "Not on the club's recruitment page";
  const parts = ["Open to new players"];
  if (team.join_type) parts.push(team.join_type.replace(/_/g, " "));
  if (team.age_group) parts.push(team.age_group);
  if (team.gender) parts.push(team.gender);
  return parts.join(" · ");
}

/**
 * The `teams` columns the tab reads. A `Pick` of the row itself rather than a
 * hand-written shape, so a column that changes nullability in the schema is a
 * type error here and not a surprise inside the recruiting panel.
 */
export type SquadTeam = Pick<
  Database["public"]["Tables"]["teams"]["Row"],
  | "id"
  | "name"
  | "age_group"
  | "recruiting"
  | "gender"
  | "join_type"
  | "join_instructions"
  | "session_details"
  | "contact_name"
  | "contact_email"
  | "contact_phone"
  | "show_coach_contact"
>;

export function SquadTab({
  team,
  data,
  sheet,
  personId,
  sheetHref,
  canEdit,
  canExportPortal,
}: {
  team: SquadTeam;
  data: SquadTabData;
  /** `?sheet=` as `page.tsx` parsed it. */
  sheet: SquadSheetMode | null;
  /** `?person=` — which member the panel is about. */
  personId: string | null;
  /** The tab's own URL with a mode and a person on it, built by the page. */
  sheetHref: (mode: SquadSheetMode | null, personId?: string | null) => string;
  /** Club administrator wearing the admin hat: add, role, shirt and End. */
  canEdit: boolean;
  /** The FA Clubs Portal exports — club administrators, admin hat. */
  canExportPortal: boolean;
}) {
  const { members, pending, squadLeave, availability, subs, season } = data;
  const leavePending = new Set(squadLeave.pendingMembershipIds);
  const players = members.filter((member) => member.role === "player");

  const facts: SquadCardFacts[] = players.map((member) => ({
    personId: member.personId,
    hasEmergencyContact: member.emergencyContacts.length > 0,
    // undefined where the question was never asked (no fixture ahead).
    availability: availability ? (availability.statusByPerson[member.personId] ?? null) : undefined,
  }));
  const counts = squadCounts(facts);

  // Only the columns this reader is entitled to. Subs are loaded for a
  // committee reader alone, and the availability column needs a fixture ahead
  // — an absent column is honest where an empty one would not be.
  const columns: DataColumn[] = [
    { key: "name", label: "Member", weight: 3 },
    { key: "role", label: "Role", weight: 2, filterKey: "role", allLabel: "Every role" },
    ...(availability
      ? [
          {
            key: "answer",
            label: availability.dayLabel,
            sub: availability.fixtureLabel,
            weight: 2,
            filterKey: "answer",
            allLabel: "Every answer",
          } satisfies DataColumn,
        ]
      : []),
    ...(subs ? [{ key: "subs", label: "Subs", weight: 2 } satisfies DataColumn] : []),
    { key: "contact", label: "Who to ring", weight: 3 },
  ];

  const items: DataItem[] = members.map((member) => {
    const isPlayer = member.role === "player";
    const answer =
      availability && isPlayer
        ? availabilityCell(availability.statusByPerson[member.personId] ?? null)
        : null;
    const sub = subs && isPlayer ? subsCell(subs.byPerson[member.personId]) : null;
    const noContact = isPlayer && member.emergencyContacts.length === 0;
    const open = sheetHref("details", member.personId);

    const meta = [
      member.shirtNumber !== null ? `#${member.shirtNumber}` : null,
      isPlayer ? team.age_group : null,
      member.isMinor ? "Under 18" : null,
    ]
      .filter(Boolean)
      .join(" · ");

    /** The name, the face and what the row is: one press opens the panel. */
    const nameCell = (
      <span className="flex items-center gap-2.5">
        <Avatar name={member.name} photoUrl={member.photoUrl} size="sm" />
        <span className="min-w-0">
          <Link
            href={open}
            className="touch flex items-center truncate font-medium underline-offset-2 hover:underline"
          >
            {member.name}
          </Link>
          {meta ? <span className="block truncate text-xs text-muted-foreground">{meta}</span> : null}
        </span>
      </span>
    );

    const contactCell = member.emergencyContacts.length > 0 ? (
      <span className="block truncate text-muted-foreground">
        {member.emergencyContacts.join(" · ")}
      </span>
    ) : noContact ? (
      <Link href={sheetHref("contacts", member.personId)} className="touch flex items-center font-medium text-warning">
        Nobody to ring
      </Link>
    ) : (
      <span className="text-muted-foreground">—</span>
    );

    return {
      key: member.id,
      haystack: `${member.name} ${ROLE_LABELS[member.role]} ${member.shirtNumber ?? ""}`.toLocaleLowerCase("en-GB"),
      facets: {
        role: ROLE_LABELS[member.role],
        ...(answer ? { answer: answer.label } : {}),
      },
      cells: (
        <>
          <td className="px-4 py-2.5">{nameCell}</td>
          <td className="px-4 py-2.5">
            {ROLE_LABELS[member.role]}
            {leavePending.has(member.id) ? (
              <Badge variant="warning" className="ml-1.5">
                Leaving
              </Badge>
            ) : null}
          </td>
          {availability ? (
            <td className="px-4 py-2.5">
              {answer ? <span className={TONE_INK[answer.tone]}>{answer.label}</span> : <span className="text-muted-foreground">—</span>}
            </td>
          ) : null}
          {subs ? (
            <td className="px-4 py-2.5">
              {sub ? <span className={TONE_INK[sub.tone]}>{sub.label}</span> : <span className="text-muted-foreground">—</span>}
            </td>
          ) : null}
          <td className="min-w-0 px-4 py-2.5">{contactCell}</td>
        </>
      ),
      card: (
        <span className="block px-4 py-3">
          {nameCell}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">{ROLE_LABELS[member.role]}</span>
            {answer ? <span className={TONE_INK[answer.tone]}>{answer.label}</span> : null}
            {sub ? <span className={TONE_INK[sub.tone]}>{sub.label}</span> : null}
            {leavePending.has(member.id) ? <Badge variant="warning">Leaving</Badge> : null}
          </span>
          <span className="mt-1 block min-w-0 truncate text-xs">{contactCell}</span>
        </span>
      ),
    };
  });

  const member = personId ? members.find((row) => row.personId === personId) ?? null : null;
  const mode = member ? sheet : null;

  return (
    <div className="space-y-4">
      {/* The squad in three figures, each a press that filters the list to
          exactly the people it counts. The chips the cards used to carry are
          the frame's column filters now, so these tiles are the summary and
          the list is the detail. */}
      <StatRow className="lg:grid-cols-3">
        <StatTile
          label="Players"
          value={counts.all}
          hint={season ? `Season ${season.name}` : "Current season"}
          icon={<Users className="h-3.5 w-3.5" aria-hidden />}
        />
        <StatTile
          label="Needs chasing"
          value={counts.chasing}
          tone={counts.chasing > 0 ? "warning" : "default"}
          hint={availability ? `No reply for ${availability.fixtureLabel}` : "Nobody to ring, or no reply"}
        />
        <StatTile
          label="Nobody to ring"
          value={counts.noContact}
          tone={counts.noContact > 0 ? "danger" : "default"}
          hint="Players with no emergency contact"
        />
      </StatRow>

      {canEdit ? (
        <FoldCard
          icon={<UserPlus className="h-4 w-4" aria-hidden />}
          title="Add a member"
          summary={
            season
              ? `Into ${team.name} for ${season.name}`
              : "No season is marked current — nothing to add to"
          }
        >
          <AddMemberPanel
            teamId={team.id}
            seasonId={season?.id ?? null}
            alreadyIn={members.map((row) => row.personId)}
          />
        </FoldCard>
      ) : null}

      <DataListFrame
        items={items}
        columns={columns}
        search={{ param: "q", placeholder: "Search the squad", initial: "" }}
        actions={
          canExportPortal ? (
            <span className="flex flex-wrap gap-2">
              {/* The Portal's spreadsheet for this one team (Adam,
                  2026-09-06: "also be available to admins in the squad
                  section of the team page"). The route refuses anyone else
                  again. */}
              <a
                href={`/teams/clubs-portal/export.csv?team=${team.id}`}
                className={buttonVariants({ variant: "outline", size: "touch" })}
              >
                Export for FA Clubs Portal
              </a>
              <a
                href={`/teams/${team.id}/photos.zip`}
                className={buttonVariants({ variant: "outline", size: "touch" })}
              >
                Export photos
              </a>
            </span>
          ) : undefined
        }
        empty={{
          icon: <Users className="h-5 w-5" aria-hidden />,
          title: season
            ? "Nobody is recorded in this team for the current season."
            : "No season is marked current, so this team has no roster to show.",
          body: season
            ? "Adding somebody goes straight to team_memberships as you, so the database decides."
            : "Make a season current on the Teams screen.",
        }}
        noMatch="Nobody in the squad matches that search or those filters."
        footerNote={`${members.length} in the team · ${counts.all} ${counts.all === 1 ? "player" : "players"}`}
      />

      {pending.length > 0 ? (
        <FoldCard
          icon={<Clock className="h-4 w-4" aria-hidden />}
          title="Waiting for a date of birth"
          summary={`${pending.length} import${pending.length === 1 ? "" : "s"} the SG-0 gate is holding back`}
          defaultOpen
        >
          <PendingImportsPanel rows={pending} />
        </FoldCard>
      ) : null}

      {/* Gap 10: what the public /recruitment page says about this team.
          Written through the caller's own client, so `teams_staff_update`
          lets a coach maintain it and the guard refuses anything else. */}
      <FoldCard
        icon={<Megaphone className="h-4 w-4" aria-hidden />}
        title="Recruiting"
        summary={recruitingSummary(team)}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            What a parent looking for a team sees on the club&apos;s public recruitment page. The
            team&apos;s name and age group are a club administrator&apos;s to change; everything
            here belongs to the people who run the team.
          </p>
          <RecruitingPanel
            teamId={team.id}
            canEdit
            values={{
              recruiting: team.recruiting,
              gender: team.gender,
              join_type: team.join_type,
              join_instructions: team.join_instructions,
              session_details: team.session_details,
              contact_name: team.contact_name,
              contact_email: team.contact_email,
              contact_phone: team.contact_phone,
              show_coach_contact: team.show_coach_contact,
            }}
          />
        </div>
      </FoldCard>

      <PersonSheet
        personName={member?.name ?? ""}
        mode={mode}
        closeHref={sheetHref(null)}
        modeHrefs={
          Object.fromEntries(
            SQUAD_SHEET_MODES.map((key) => [key, sheetHref(key, personId)]),
          ) as Record<PersonSheetMode, string>
        }
        modes={SQUAD_SHEET_MODES}
        captions={SQUAD_SHEET_CAPTIONS}
        labels={SQUAD_SHEET_LABELS}
        canEdit={canEdit}
        canAdmin={canEdit}
        isSuperUser={false}
      >
        {member && mode ? (
          <SquadSheetBody
            mode={mode}
            data={{
              teamId: team.id,
              teamName: team.name,
              ageGroup: team.age_group,
              seasonName: season?.name ?? null,
              member,
              canEdit,
              canRequestLeave: squadLeave.canRequest,
              leavePending: leavePending.has(member.id),
              availability:
                availability && member.role === "player"
                  ? (availability.statusByPerson[member.personId] ?? null)
                  : undefined,
              fixtureLabel: availability?.fixtureLabel ?? null,
              sub: subs?.byPerson[member.personId],
              showSubs: subs !== null,
            }}
          />
        ) : null}
      </PersonSheet>
    </div>
  );
}
