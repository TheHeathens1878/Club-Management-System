import { notFound, redirect } from "next/navigation";

import type { Database } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { isMemberView, resolveRoleView } from "@/lib/role-view";
import {
  loadBookingDetail,
  loadBookingFixture,
  loadBookingTeams,
  type BookingFixture,
} from "@/lib/booking-detail";
import { nameOf, resolveNames } from "@/lib/person";
import { headcountLabel, summariseAvailability } from "@/lib/headcount";
import { formatSlot, kindLabel, statusLabel, statusVariant } from "@/lib/pitch-booking";
import { createClient } from "@/lib/supabase/server";

import { AvailabilityPanel, type AvailabilitySubject } from "./availability-panel";
import { AttendancePanel, type RosterRow } from "./attendance-panel";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];
type AttendanceStatus = Database["public"]["Enums"]["attendance_status"];
type TeamRole = Database["public"]["Enums"]["team_role"];

type AvailabilityRow = {
  person_id: string;
  status: AvailabilityStatus;
  note: string | null;
};

/**
 * `/pitches/[bookingId]` — one session, and the two questions about it (gap 8).
 *
 * There is no role gate on this page beyond being signed in, and that is
 * deliberate. `loadBookingDetail()` reads as the caller — `bookings` first,
 * `pitch_calendar()` second — so a session this person may not see simply is
 * not there and the page 404s, exactly as it would for an id that never
 * existed. Every capability question below (`is_staff_of_booking`,
 * `is_club_admin`, `is_member_of_booking`) is likewise the database's own
 * answer, asked through the caller's client. The panels are the convenience;
 * `booking_availability_*` and `booking_attendance_staff_write` are the rule.
 *
 * A fixture booking behaves the same way with one substitution: availability
 * is written to `public.availability`, keyed on `fixture_id`, because that is
 * where the fixture's answers already live and the selection screens read
 * them. Attendance stays on the booking either way — the sheet is about the
 * session, and a fixture's session is its booking.
 *
 * No date of birth is read, sent or rendered anywhere on this page. The minor
 * badge comes from `is_minor()`, which returns a boolean and nothing else.
 */
export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { bookingId } = await params;
  const booking = await loadBookingDetail(bookingId);
  if (!booking) notFound();

  const supabase = await createClient();

  const [teams, staffResult, adminResult, personResult, childrenResult] = await Promise.all([
    loadBookingTeams(bookingId),
    supabase.rpc("is_staff_of_booking", { p_booking_id: bookingId }),
    supabase.rpc("is_club_admin"),
    supabase.rpc("current_person_id"),
    supabase.rpc("my_children"),
  ]);

  // Adam, 2026-09-02: "As a parent for the U14 Mavericks, I can mark who
  // attended. This should only be available to coaches (even though I am also
  // a coach)." Holding the coach hat is what ADMITS somebody to the register;
  // wearing a parent's hat is what puts it away. Without the second half, the
  // one person on the team who is both saw the whole squad's answers and the
  // attendance ticks on a screen every other parent gets the availability form
  // on — which is precisely the difference he is asking to see.
  //
  // The roster read below hangs off this too, so a parent view does not fetch
  // the squad at all: the hidden panel was not the only leak, the data was.
  const view = resolveRoleView(await getStoredRoleView(), await getCapabilities());
  const canMarkAttendance =
    (staffResult.data === true || adminResult.data === true) && !isMemberView(view);
  const personId = personResult.data ?? null;
  const teamIds = teams.map((team) => team.id);
  const teamNameById = new Map(teams.map((team) => [team.id, team.name]));

  const fixture: BookingFixture | null = booking.fixtureId
    ? await loadBookingFixture(booking.fixtureId)
    : null;

  // ------------------------------------------------------------------
  // Who this caller may answer for: themselves, and every child they
  // guard — each of them only if `is_member_of_booking()` says they are in
  // one of the teams on this session. That is the same predicate the insert
  // policy applies, so the form never offers a row the database would refuse.
  // ------------------------------------------------------------------
  const candidates: { personId: string; isSelf: boolean; relationship: string | null }[] = [];
  if (personId) candidates.push({ personId, isSelf: true, relationship: null });
  for (const child of childrenResult.data ?? []) {
    if (child.person_id === personId) continue;
    candidates.push({ personId: child.person_id, isSelf: false, relationship: child.relationship });
  }

  const membership = await Promise.all(
    candidates.map(async (candidate) => {
      const { data } = await supabase.rpc("is_member_of_booking", {
        p_person_id: candidate.personId,
        p_booking_id: bookingId,
      });
      return { candidate, isMember: data === true };
    }),
  );
  const eligible = membership.filter((row) => row.isMember).map((row) => row.candidate);

  // ------------------------------------------------------------------
  // The roster, for staff and administrators only. Read as the caller, so
  // `team_memberships_staff_read` / `_admin_read` decide what comes back —
  // a coach of one of two sharing teams gets their own team's rows and the
  // sheet is honestly short rather than quietly wrong.
  // ------------------------------------------------------------------
  type MembershipRow = {
    person_id: string;
    team_id: string;
    role: TeamRole;
    shirt_number: number | null;
  };
  let memberships: MembershipRow[] = [];
  if (canMarkAttendance && teamIds.length > 0) {
    const { data } = await supabase
      .from("team_memberships")
      .select("person_id,team_id,role,shirt_number")
      .in("team_id", teamIds)
      .is("left_at", null);
    // Someone in two of the sharing teams is one person on one sheet.
    const seen = new Set<string>();
    memberships = (data ?? []).filter((row) => {
      if (seen.has(row.person_id)) return false;
      seen.add(row.person_id);
      return true;
    });
  }

  const peopleIds = Array.from(
    new Set([...eligible.map((row) => row.personId), ...memberships.map((row) => row.person_id)]),
  );

  // ------------------------------------------------------------------
  // What has already been answered. A fixture's availability lives in
  // `availability` keyed on the fixture; everything else in
  // `booking_availability` keyed on the booking. Attendance is always the
  // booking's.
  // ------------------------------------------------------------------
  const [availabilityResult, attendanceResult, names] = await Promise.all([
    peopleIds.length === 0
      ? Promise.resolve({ data: [] as AvailabilityRow[] })
      : fixture
        ? supabase
            .from("availability")
            .select("person_id,status,note")
            .eq("fixture_id", fixture.id)
            .in("person_id", peopleIds)
        : supabase
            .from("booking_availability")
            .select("person_id,status,note")
            .eq("booking_id", bookingId)
            .in("person_id", peopleIds),
    peopleIds.length === 0
      ? Promise.resolve({
          data: [] as { person_id: string; status: AttendanceStatus; note: string | null }[],
        })
      : supabase
          .from("booking_attendance")
          .select("person_id,status,note")
          .eq("booking_id", bookingId)
          .in("person_id", peopleIds),
    resolveNames(peopleIds),
  ]);

  const availabilityByPerson = new Map(
    (availabilityResult.data ?? []).map((row) => [row.person_id, row]),
  );
  const attendanceByPerson = new Map(
    (attendanceResult.data ?? []).map((row) => [row.person_id, row]),
  );

  const minorFlags = new Map(
    await Promise.all(
      peopleIds.map(async (id) => {
        const { data } = await supabase.rpc("is_minor", { person_id: id });
        return [id, data === true] as const;
      }),
    ),
  );

  const subjects: AvailabilitySubject[] = eligible.map((candidate) => {
    const existing = availabilityByPerson.get(candidate.personId);
    return {
      personId: candidate.personId,
      name: nameOf(names, candidate.personId),
      isMinor: minorFlags.get(candidate.personId) === true,
      isSelf: candidate.isSelf,
      relationship: candidate.relationship,
      status: existing?.status ?? null,
      note: existing?.note ?? null,
    };
  });

  const roster: RosterRow[] = memberships
    .map((row) => {
      const availability = availabilityByPerson.get(row.person_id);
      const attendance = attendanceByPerson.get(row.person_id);
      return {
        personId: row.person_id,
        name: nameOf(names, row.person_id),
        isMinor: minorFlags.get(row.person_id) === true,
        teamName: teamNameById.get(row.team_id) ?? "Team",
        role: row.role,
        shirtNumber: row.shirt_number,
        availability: availability?.status ?? null,
        availabilityNote: availability?.note ?? null,
        attendance: attendance?.status ?? null,
        attendanceNote: attendance?.note ?? null,
      } satisfies RosterRow;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // "How many children will be there?" — squad availability, staff eyes only
  // (a parent's client only reads their own household, so their count would be
  // partial and misleading).
  const headcount = canMarkAttendance
    ? summariseAvailability(
        (availabilityResult.data ?? []).map((row) => ({
          person_id: row.person_id,
          status: row.status,
        })),
        memberships.filter((row) => row.role === "player").map((row) => row.person_id),
      )
    : null;

  // The way back names where it goes: the register-taker came from their own
  // bookings, everyone else from the calendar.
  const back = canMarkAttendance
    ? { href: "/pitches/mine", label: "Pitch bookings" }
    : { href: "/pitches/calendar", label: "Pitch calendar" };
  const title = fixture
    ? `${booking.teamName ?? "Team"} v ${fixture.opponent}`
    : (booking.label ?? booking.teamName ?? "Pitch booking");

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`${formatSlot(booking)} · ${booking.resourceName}`}
        back={back}
      />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(booking.status)}>{statusLabel(booking.status)}</Badge>
          <Badge variant="muted">{kindLabel(booking.kind)}</Badge>
          {fixture && <Badge variant="outline">{fixture.isHome ? "Home" : "Away"}</Badge>}
          {fixture?.competition && <Badge variant="outline">{fixture.competition}</Badge>}
          {teams.map((team) => (
            <Badge key={team.id} variant="outline">
              {team.id === booking.teamId ? team.name : `${team.name} (sharing)`}
            </Badge>
          ))}
          {headcount && (
            <Badge variant="default">
              {headcountLabel(headcount)} of {headcount.squad}
            </Badge>
          )}
        </div>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">The session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0 text-sm lg:p-6 lg:pt-0">
            <p>
              <span className="text-muted-foreground">When:</span> {formatSlot(booking)}
            </p>
            <p>
              <span className="text-muted-foreground">Where:</span> {booking.resourceName}
            </p>
            {fixture && (
              <p>
                <span className="text-muted-foreground">Opponent:</span> {fixture.opponent} ·{" "}
                {fixture.isHome ? "home" : "away"} · {fixture.status}
              </p>
            )}
            {booking.notes && (
              <p className="whitespace-pre-line">
                <span className="text-muted-foreground">Notes:</span> {booking.notes}
              </p>
            )}
            {booking.calendarOnly && (
              <p className="text-xs text-muted-foreground">
                Shown from the club&apos;s pitch calendar, so the booker&apos;s details are not
                included. That is the calendar doing its job, not a missing field.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Availability</CardTitle>
            <p className="text-sm text-muted-foreground">
              {fixture
                ? "Whether you can play. A fixture's answers are kept with the fixture, so the coach sees the same reply on the selection screen."
                : "Whether you can make it. A parent or guardian can answer for each of their children who is in one of the teams on this session."}
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <AvailabilityPanel
              bookingId={booking.id}
              fixtureId={fixture?.id ?? null}
              subjects={subjects}
            />
          </CardContent>
        </Card>

        {canMarkAttendance && (
          /* The team page links here as `#attendance`, so the sheet is what a
             coach lands on rather than the top of the booking. */
          <Card id="attendance" className="scroll-mt-6">
            <CardHeader className="p-4 lg:p-6">
              <CardTitle className="text-base">Roster and attendance</CardTitle>
              <p className="text-sm text-muted-foreground">
                Everyone still in the teams on this session, what they said, and who turned up.
                Attendance is the team&apos;s record to keep — the player and their guardian can
                read their own row, and nobody else&apos;s.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
              <AttendancePanel bookingId={booking.id} rows={roster} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
