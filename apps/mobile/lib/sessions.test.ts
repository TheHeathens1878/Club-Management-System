import { describe, expect, it } from "vitest";

import {
  indexSessionAvailability,
  sessionRespondentsFor,
  sessionTeamIds,
  toSessions,
  type SessionRow,
} from "./sessions";
import type { HouseholdMember } from "./household";
import type { PlayerMembership } from "./fixtures";

const row = (over: Partial<SessionRow>): SessionRow => ({
  booking_id: "b1",
  resource_name: "Dainewell Park",
  kind: "training",
  status: "confirmed",
  starts_at: "2026-09-08T17:30:00Z",
  ends_at: "2026-09-08T18:30:00Z",
  label: "U14 Mavericks",
  team_id: "t1",
  team_name: "U14 Mavericks",
  shared_team_ids: null,
  ...over,
});

const household: HouseholdMember[] = [
  { personId: "me", name: "Adam", isSelf: true, relationship: null },
  { personId: "kid", name: "Sam", isSelf: false, relationship: "parent" },
];
const memberships: PlayerMembership[] = [
  { personId: "kid", teamId: "t1", seasonId: "s1" },
];

describe("sessions", () => {
  it("collects the session's own team and every sharing team", () => {
    expect(sessionTeamIds(row({ shared_team_ids: ["t2", "t1"] }))).toEqual(["t1", "t2"]);
    expect(sessionTeamIds(row({ team_id: null, shared_team_ids: ["t2"] }))).toEqual(["t2"]);
  });

  it("offers the toggle to household players of the session's teams only", () => {
    const availability = indexSessionAvailability([
      { booking_id: "b1", person_id: "kid", status: "available" },
    ]);
    const respondents = sessionRespondentsFor(row({}), household, memberships, availability);
    expect(respondents).toEqual([{ personId: "kid", label: "Sam", status: "available" }]);
  });

  it("only training bookings become sessions, soonest first, household-relevant only", () => {
    const sessions = toSessions(
      [
        row({ booking_id: "later", starts_at: "2026-09-15T17:30:00Z" }),
        row({ booking_id: "b1" }),
        row({ booking_id: "hire", kind: "hire" }),
        row({ booking_id: "match", kind: "fixture" }),
        row({ booking_id: "other-team", team_id: "t9", label: "Someone else" }),
      ],
      household,
      memberships,
      [],
    );
    expect(sessions.map((s) => s.id)).toEqual(["b1", "later"]);
    expect(sessions[0]!.title).toBe("U14 Mavericks");
    expect(sessions[0]!.respondents[0]!.personId).toBe("kid");
  });
});
