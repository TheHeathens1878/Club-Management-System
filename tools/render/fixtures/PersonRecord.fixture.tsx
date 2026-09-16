/**
 * `/people/[id]` above the fold, in the three states the status bar has an
 * opinion about.
 *
 * The page itself is a server component that reads eight tables, so what is
 * photographed here is its COMPOSITION — the same header, the same
 * `ActionBar`, the same `PersonFacts` band, the same team list and the same
 * three folds, given by hand the props the page computes. The thing being
 * checked is the shape: that a record with a long refusal sentence in the bar
 * still fits inside a 900px desk viewport down to the third folded row, and
 * that two columns of tiles and a season of teams survive 390.
 *
 * The fold bodies are stand-ins. The real ones are client panels with server
 * actions behind them, and they are photographed by their own fixtures; a
 * paragraph of the right height is what this composition needs from them.
 */

import {
  AlertTriangle,
  Clock,
  FileText,
  History,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";

import { Avatar } from "@/components/avatar";
import { PersonFacts, type PersonFactsData } from "@/components/person/person-facts";
import { PersonTeams, type PersonTeamRow } from "@/components/person/person-teams";
import { PageHeader } from "@/components/page-header";
import { ActionBar } from "@/components/ui/action-bar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FoldCard } from "@/components/ui/fold-card";
import { personNextAction, type PersonRecordInput } from "@/lib/person-record-state";

import type { Fixture } from "./contract";

const TEAMS: PersonTeamRow[] = [
  {
    id: "1",
    teamId: "t1",
    teamName: "U12 Mavericks",
    seasonName: "2026/27",
    seasonIsCurrent: true,
    role: "player",
    shirtNumber: 7,
    joinedAt: "2026-08-01T09:00:00Z",
    leftAt: null,
  },
  {
    id: "2",
    teamId: "t2",
    teamName: "U11 Venus",
    seasonName: "2025/26",
    seasonIsCurrent: false,
    role: "player",
    shirtNumber: 11,
    joinedAt: "2025-08-04T09:00:00Z",
    leftAt: "2026-06-30T09:00:00Z",
  },
];

const COACH_TEAMS: PersonTeamRow[] = [
  {
    id: "3",
    teamId: "t1",
    teamName: "U12 Mavericks",
    seasonName: "2026/27",
    seasonIsCurrent: true,
    role: "coach",
    shirtNumber: null,
    joinedAt: "2026-07-14T09:00:00Z",
    leftAt: null,
  },
];

const BUTTON: Record<string, string> = {
  "apply-imports": "Add the date of birth",
  "add-dob": "Add a date of birth",
  "add-emergency-contact": "Add a contact",
  "record-id-seen": "Record ID seen",
  "record-complete": "Edit details",
};

const ICON: Record<string, React.ReactNode> = {
  "apply-imports": <Clock className="h-4 w-4" aria-hidden />,
  "add-dob": <AlertTriangle className="h-4 w-4" aria-hidden />,
  "add-emergency-contact": <AlertTriangle className="h-4 w-4" aria-hidden />,
  "record-id-seen": <ShieldCheck className="h-4 w-4" aria-hidden />,
  "record-complete": <UserRoundCheck className="h-4 w-4" aria-hidden />,
};

function Record({
  title,
  email,
  input,
  facts,
  teams,
  imports,
}: {
  title: string;
  email: string;
  input: PersonRecordInput;
  facts: PersonFactsData;
  teams: PersonTeamRow[];
  imports?: number;
}) {
  const next = personNextAction(input);
  const quiet = next.key === "record-complete";

  return (
    <>
      <PageHeader
        title={title}
        subtitle={email}
        back={{ href: "/people", label: "People" }}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {facts.retired && <Badge variant="destructive">Retired</Badge>}
            <Avatar name={title} photoUrl={null} size="lg" />
          </div>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        <ActionBar
          icon={ICON[next.key]}
          tone={next.tone}
          status={quiet ? next.why : next.label}
          detail={quiet ? undefined : next.why}
          action={
            <a
              href="?sheet=details"
              className={buttonVariants({ size: "touch", variant: quiet ? "outline" : "default" })}
            >
              {BUTTON[next.key]}
            </a>
          }
        />

        <PersonFacts facts={facts} hrefFor={(key) => (key === "teams" ? "#person-teams" : `?sheet=${key}`)} />

        {imports ? (
          <Callout tone="warning" icon={<Clock className="h-4 w-4" aria-hidden />} title="Waiting to be applied">
            <p>
              Records imported from the pitch-booking app that SG-4 and SG-6 will not accept until
              this person&apos;s date of birth is known.
            </p>
          </Callout>
        ) : null}

        <Card id="person-teams">
          <CardHeader className="pb-3">
            <CardTitle>Teams</CardTitle>
          </CardHeader>
          <CardContent>
            <PersonTeams rows={teams} />
          </CardContent>
        </Card>

        <div className="space-y-2 pt-2">
          <FoldCard
            icon={<History className="h-4 w-4" aria-hidden />}
            title="Record"
            summary="Created 3 Jan 2025, 09:12 · last changed 4 Sep 2026, 18:40 · born 14 Mar 2014"
          >
            <p className="text-sm text-muted-foreground">Retire and restore live here.</p>
          </FoldCard>
          <FoldCard
            icon={<FileText className="h-4 w-4" aria-hidden />}
            title="From the latest registration"
            summary="2026/27 registration, answered 12 Aug 2026 · approved"
          >
            <p className="text-sm text-muted-foreground">The read-only answer sheet lives here.</p>
          </FoldCard>
          <FoldCard
            icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
            title="Proof of identity"
            summary="Passport uploaded 12 Aug 2026, 10:04 · destroyed 2029-08-12"
          >
            <p className="text-sm text-muted-foreground">Documents and the ID tick live here.</p>
          </FoldCard>
        </div>
      </div>
    </>
  );
}

const fixture: Fixture = {
  cases: {
    // A child with a birthday on file and nobody to ring: the bar is the
    // longest sentence the band has to sit under.
    minorMissingContact: () => (
      <Record
        title="Amelia Wareing"
        email="No email on file"
        input={{
          person: { dob: "2014-03-14", id_verified: false, updated_at: "2026-09-04T18:40:00Z" },
          pendingImports: 0,
          emergencyContacts: 0,
          childFacingRoles: [],
          identityDocuments: 0,
        }}
        facts={{
          ageGroup: "U13",
          isMinor: true,
          hasDob: true,
          loginRole: null,
          membershipWord: "Family",
          membershipSeason: "2026/27",
          memberNo: "00042B",
          memberNoStatus: null,
          roles: 1,
          guardians: 0,
          children: 0,
          teams: 2,
          liveTeams: 1,
          idSeen: false,
          idNeeded: false,
          retired: false,
        }}
        teams={TEAMS}
      />
    ),

    // Nothing outstanding: the quiet bar, and the band saying so.
    adultComplete: () => (
      <Record
        title="Adam Wareing"
        email="adam@example.com"
        input={{
          person: { dob: "1981-05-02", id_verified: true, updated_at: "2026-09-04T18:40:00Z" },
          pendingImports: 0,
          emergencyContacts: 2,
          childFacingRoles: ["coach"],
          identityDocuments: 1,
        }}
        facts={{
          ageGroup: null,
          isMinor: false,
          hasDob: true,
          loginRole: "club_admin",
          membershipWord: "Family",
          membershipSeason: "2026/27 · current season",
          memberNo: "00042A",
          memberNoStatus: null,
          roles: 3,
          guardians: 0,
          children: 2,
          teams: 1,
          liveTeams: 1,
          idSeen: true,
          idNeeded: false,
          retired: false,
        }}
        teams={COACH_TEAMS}
      />
    ),

    // The migration queue, which is the only state with a second block of
    // text between the band and the first card.
    importsWaiting: () => (
      <Record
        title="Ben Hartley"
        email="No email on file"
        imports={3}
        input={{
          person: { dob: null, id_verified: false, updated_at: "2026-09-12T08:05:00Z" },
          pendingImports: 3,
          emergencyContacts: 0,
          childFacingRoles: [],
          identityDocuments: 0,
        }}
        facts={{
          ageGroup: null,
          isMinor: true,
          hasDob: false,
          loginRole: null,
          membershipWord: null,
          membershipSeason: null,
          memberNo: null,
          memberNoStatus: null,
          roles: 0,
          guardians: 0,
          children: 0,
          teams: 0,
          liveTeams: 0,
          idSeen: false,
          idNeeded: false,
          retired: false,
        }}
        teams={[]}
      />
    ),
  },
};

export default fixture;
