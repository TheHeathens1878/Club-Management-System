import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ClipboardList, MapPin } from "lucide-react";

import type { Database } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";
import { headcountLabel, summariseAvailability } from "@/lib/headcount";
import { getCurrentPersonId, isClubAdmin, nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { fixtureStatusVariant } from "../../fixtures-shared";
import { googleMapsUrl } from "../../../../events/shared";
import { FixtureAvailabilityPanel, type FixtureSubject } from "./availability-panel";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];

/**
 * One fixture's attendance marker (goal: "know how many children will be
 * there"). Works for every fixture — home, away, allocated or not — because
 * availability is keyed on the fixture itself; the pitch booking sheet at
 * /pitches/[bookingId] stays the place the day-of register is ticked.
 *
 * Reads as the caller throughout: a parent sees and answers for their own
 * household (`can_act_for`), team staff see the squad and every answer
 * (`availability_read`), and the write policies — not this page — are what
 * refuse anything else.
 */
export default async function FixtureAttendancePage({
  params,
}: {
  params: Promise<{ id: string; fixtureId: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { id: teamId, fixtureId } = await params;
  const supabase = await createClient();
  const personId = await getCurrentPersonId();

  const { data: fixture } = await supabase
    .from("fixtures")
    .select(
      "id,team_id,kickoff_at,is_home,opponent,competition,status,venue_text,booking_id,seasons(name),teams:team_id(name),resources!fixtures_venue_resource_id_fkey(name)",
    )
    .eq("id", fixtureId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (!fixture) notFound();

  const [staffResult, admin, childrenResult, eventResult] = await Promise.all([
    supabase.rpc("is_team_staff", { p_team_id: teamId }),
    isClubAdmin(),
    supabase.rpc("my_children"),
    // The fixture's RSVP event (events module) — one per fixture, if synced.
    supabase.from("events").select("id").eq("fixture_id", fixtureId).maybeSingle(),
  ]);
  const eventId = eventResult.data?.id ?? null;
  const canManage = staffResult.data === true || admin;

  // Who the caller may answer for: themselves and their children — kept to
  // those with a live membership on this team, the same fact the write guard
  // checks, so the form never offers a row the database would refuse.
  const candidates: { personId: string; isSelf: boolean; relationship: string | null }[] = [];
  if (personId) candidates.push({ personId, isSelf: true, relationship: null });
  for (const child of childrenResult.data ?? []) {
    if (child.person_id === personId) continue;
    candidates.push({ personId: child.person_id, isSelf: false, relationship: child.relationship });
  }

  const { data: membershipRows } = await supabase
    .from("team_memberships")
    .select("person_id,role,shirt_number")
    .eq("team_id", teamId)
    .is("left_at", null);
  const memberships = membershipRows ?? [];
  const memberIds = new Set(memberships.map((row) => row.person_id));
  const shirtByPerson = new Map(memberships.map((row) => [row.person_id, row.shirt_number]));
  const eligible = candidates.filter((candidate) => memberIds.has(candidate.personId));

  // The squad — live players — is the headcount's denominator and, for staff,
  // the roster panel. A parent's client only gets their own household's
  // membership rows back, which is exactly as much roster as they should see.
  const playerIds = memberships
    .filter((row) => row.role === "player")
    .map((row) => row.person_id);

  const { data: availabilityRows } = await supabase
    .from("availability")
    .select("person_id,status,note")
    .eq("fixture_id", fixtureId);
  const availability = new Map(
    (availabilityRows ?? []).map((row) => [
      row.person_id,
      { status: row.status as AvailabilityStatus, note: row.note },
    ]),
  );

  const peopleIds = Array.from(new Set([...eligible.map((c) => c.personId), ...playerIds]));
  const [names, minorFlags] = await Promise.all([
    resolveNames(peopleIds),
    Promise.all(
      peopleIds.map(async (pid) => {
        const { data } = await supabase.rpc("is_minor", { person_id: pid });
        return [pid, data === true] as const;
      }),
    ).then((entries) => new Map(entries)),
  ]);

  const toSubject = (
    pid: string,
    isSelf: boolean,
    relationship: string | null,
  ): FixtureSubject => ({
    personId: pid,
    name: nameOf(names, pid),
    isMinor: minorFlags.get(pid) === true,
    isSelf,
    relationship,
    shirtNumber: shirtByPerson.get(pid) ?? null,
    status: availability.get(pid)?.status ?? null,
    note: availability.get(pid)?.note ?? null,
  });

  const household = eligible.map((c) => toSubject(c.personId, c.isSelf, c.relationship));
  const householdIds = new Set(household.map((s) => s.personId));
  const squad = canManage
    ? playerIds
        .filter((pid) => !householdIds.has(pid))
        .map((pid) => toSubject(pid, pid === personId, null))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const headcount = canManage
    ? summariseAvailability(
        (availabilityRows ?? []).map((row) => ({
          person_id: row.person_id,
          status: row.status as AvailabilityStatus,
        })),
        playerIds,
      )
    : null;

  const local = instantToLocal(fixture.kickoff_at);
  const teamName = (fixture.teams as { name: string } | null)?.name ?? "Team";
  const title = fixture.is_home
    ? `${teamName} v ${fixture.opponent}`
    : `${fixture.opponent} v ${teamName}`;
  const pitchName = (fixture.resources as { name: string } | null)?.name ?? null;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`${formatBookingDateShort(local.date)} · ${local.time} · ${
          fixture.is_home ? (pitchName ?? "Home") : (fixture.venue_text ?? "Away")
        }`}
        action={
          <Link
            href={`/teams/${teamId}?tab=matchday`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ChevronLeft className="h-4 w-4" /> Back to fixtures
          </Link>
        }
      />

      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={fixtureStatusVariant(fixture.status)} className="capitalize">
            {fixture.status}
          </Badge>
          <Badge variant="muted">{fixture.is_home ? "Home" : "Away"}</Badge>
          {fixture.competition && <Badge variant="outline">{fixture.competition}</Badge>}
          {headcount && (
            <Badge variant="default">
              {headcountLabel(headcount)} of {headcount.squad}
            </Badge>
          )}
          {(pitchName || fixture.venue_text) && (
            <a
              href={googleMapsUrl(
                fixture.is_home
                  ? (pitchName ?? fixture.venue_text ?? "")
                  : (fixture.venue_text ?? ""),
              )}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <MapPin className="h-4 w-4" /> Map
            </a>
          )}
          {eventId && (
            <Link
              href={`/events/${eventId}`}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Event &amp; RSVP
            </Link>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your household</CardTitle>
            <p className="text-sm text-muted-foreground">
              Who is coming to this {fixture.is_home ? "match" : "away match"}? Answer for yourself
              and any of your children in the squad — the coach sees the count.
            </p>
          </CardHeader>
          <CardContent>
            <FixtureAvailabilityPanel
              fixtureId={fixture.id}
              teamId={teamId}
              subjects={household}
              emptyText="Nobody in your household is in this fixture's team, so there is nothing to answer here."
            />
          </CardContent>
        </Card>

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Squad</CardTitle>
              <p className="text-sm text-muted-foreground">
                Every player&apos;s answer. As team staff you can set a player&apos;s availability
                when the answer arrives some other way (a message, a call at the school gate).
              </p>
            </CardHeader>
            <CardContent>
              <FixtureAvailabilityPanel
                fixtureId={fixture.id}
                teamId={teamId}
                subjects={squad}
                emptyText="No other players in the squad yet."
              />
            </CardContent>
          </Card>
        )}

        {canManage && fixture.booking_id && (
          <p className="text-sm text-muted-foreground">
            <ClipboardList className="mr-1 inline h-4 w-4 align-text-bottom" />
            On the day, tick the register on the{" "}
            <Link
              href={`/pitches/${fixture.booking_id}#attendance`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              pitch booking sheet
            </Link>
            .
          </p>
        )}
      </div>
    </>
  );
}
