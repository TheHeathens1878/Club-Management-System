import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CircleCheck,
  ClipboardList,
  MapPin,
  Pencil,
  Repeat,
  User,
} from "lucide-react";

import type { Json } from "@club/db";

import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { signPeoplePhotos } from "@/lib/avatars";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { resolveRoleView } from "@/lib/role-view";
import { scorelineLabel } from "@/lib/scoreline";
import { createClient } from "@/lib/supabase/server";

import {
  LineupSection,
  loadLineupSection,
} from "../../teams/[id]/fixtures/[fixtureId]/lineup/lineup-section";
import { AssignPitch } from "./assign-pitch";
import { EventTabs, eventTabFrom } from "./event-tabs";
import { MatchStatsSection } from "./match-stats-section";
import { ScorelineSection } from "./scoreline-section";
import { RespondButtons } from "../respond-buttons";
import {
  eventTypeLabel,
  formatEventDate,
  formatEventTime,
  googleMapsUrl,
  type EventPerson,
  responseLabel,
  responseVariant,
} from "../shared";
import { RemindButton } from "./remind-button";

/**
 * The event page (Adam, 2026-08-24): the viewer's acceptance status, date &
 * time, venue with a Google Maps search and a green confirmation when the
 * venue is booked, the series it belongs to, who created it — and on the
 * right, the organisers (coaches) with their acceptance, the players accepted
 * and declined, and everyone yet to answer with a Remind button for staff.
 *
 * Two SECURITY DEFINER functions feed it: `event_detail` (the card on the
 * left) and `event_people` (the roster on the right, refused to anyone who is
 * not in the team, a guardian of it, its staff or an admin — that refusal is
 * rendered as a quiet note, not an error page).
 *
 * A MATCH gets tabs (Adam, 2026-08-25: "The event (match) page should have tabs
 * showing details, line-up, match-stats … and scoreline"). They are URL-driven
 * (`?tab=`) and server-rendered, the same idea as the team page's `TeamTabs`,
 * so every tab is a link that can be shared and gone back from. Details is the
 * page exactly as it was. Only a fixture-mirrored event has a bar at all — a
 * training session or a social has nothing to put in the other three, so its
 * page is untouched.
 */

export const dynamic = "force-dynamic";

type Detail = {
  id: string;
  teamId: string;
  teamName: string;
  type: string;
  title: string;
  status: string;
  fixtureId: string | null;
  startsAt: string;
  endsAt: string | null;
  /** When to arrive — starts_at minus meet_minutes_before (Adam, 2026-08-25). */
  meetAt: string | null;
  venue: string | null;
  /** The pitch's address from Manage venues — the maps link's target (Adam). */
  venueAddress: string | null;
  notes: string | null;
  createdByName: string;
  booked: boolean;
  /** 'confirmed' | 'pending' | … from the linked booking, when there is one. */
  bookingStatus: string | null;
  /** Set when the kickoff or venue changed after people started answering. */
  detailsChangedAt: string | null;
  changeNote: string | null;
  series: { title: string; weekday: string; time: string; repeatUntil: string; occurrences: number } | null;
};

function str(record: Record<string, Json | undefined>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

/** `event_detail()` is jsonb built by the function; read it defensively. */
function parseDetail(value: Json | null): Detail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, Json | undefined>;
  const id = str(record, "id");
  const startsAt = str(record, "starts_at");
  if (!id || !startsAt) return null;

  let series: Detail["series"] = null;
  const rawSeries = record["series"];
  if (rawSeries && typeof rawSeries === "object" && !Array.isArray(rawSeries)) {
    const s = rawSeries as Record<string, Json | undefined>;
    series = {
      title: str(s, "title") ?? "",
      weekday: str(s, "weekday") ?? "",
      time: str(s, "time") ?? "",
      repeatUntil: str(s, "repeat_until") ?? "",
      occurrences: typeof s["occurrences"] === "number" ? s["occurrences"] : 0,
    };
  }

  return {
    id,
    teamId: str(record, "team_id") ?? "",
    teamName: str(record, "team_name") ?? "Team",
    type: str(record, "type") ?? "practice",
    title: str(record, "title") ?? "Event",
    status: str(record, "status") ?? "scheduled",
    fixtureId: str(record, "fixture_id"),
    startsAt,
    endsAt: str(record, "ends_at"),
    meetAt: str(record, "meet_at"),
    venue: str(record, "venue"),
    venueAddress: str(record, "venue_address"),
    notes: str(record, "notes"),
    createdByName: str(record, "created_by_name") ?? "the club",
    booked: record["booked"] === true,
    bookingStatus: str(record, "booking_status"),
    detailsChangedAt: str(record, "details_changed_at"),
    changeNote: str(record, "change_note"),
    series,
  };
}

type RosterRow = {
  person_id: string;
  full_name: string;
  team_role: string;
  is_organiser: boolean;
  response: string | null;
  responded_at: string | null;
  can_respond: boolean;
  note: string | null;
  response_stale: boolean;
};

function asResponse(value: string | null): "accepted" | "declined" | null {
  return value === "accepted" || value === "declined" ? value : null;
}

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const { id } = await params;
  const { tab: rawTab } = await searchParams;

  const supabase = await createClient();
  const { data: detailRaw, error: detailError } = await supabase.rpc("event_detail", {
    p_event_id: id,
  });
  if (detailError) notFound();
  const detail = parseDetail(detailRaw);
  if (!detail) notFound();

  // The roster is refused to outsiders (P0001) — that is a fact to render,
  // not a failure.
  const peopleResult = await supabase.rpc("event_people", { p_event_id: id });
  const roster: RosterRow[] = peopleResult.data ?? [];
  const rosterHidden = !!peopleResult.error;

  const { data: staffAnswer } = await supabase.rpc("is_team_staff", { p_team_id: detail.teamId });
  const isStaff = staffAnswer === true;

  // Admins assign the pitch right here (Adam, 2026-08-25): offered when the
  // event holds no confirmed pitch yet — a fixture reassign included.
  const capabilities = await getCapabilities();
  // …and only while wearing the admin hat (Adam, 2026-08-25: "make sure
  // coaches cannot assign pitches") — an admin looking at the event as a
  // coach sees what a coach sees.
  const hat = resolveRoleView(await getStoredRoleView(), capabilities);
  const canAssignPitch =
    capabilities.isClubAdmin &&
    (hat === "admin" || hat === null) &&
    detail.status === "scheduled" &&
    !detail.booked;
  // The select opens on the team's home pitch (Adam, 2026-08-25: allocation
  // defaults to the team's own venue) — a starting value, not a rule.
  const [{ data: pitchRows }, { data: teamRow }] = canAssignPitch
    ? await Promise.all([
        supabase
          .from("resources")
          .select("id,name")
          .eq("type", "pitch")
          .eq("active", true)
          .order("sort_order")
          .order("name"),
        supabase.from("teams").select("home_resource_id").eq("id", detail.teamId).maybeSingle(),
      ])
    : [{ data: null }, { data: null }];
  const pitches = pitchRows ?? [];
  const homeResourceId = teamRow?.home_resource_id ?? null;

  const mine: EventPerson[] = roster
    .filter((row) => row.can_respond)
    .map((row) => ({
      personId: row.person_id,
      name: row.full_name,
      isSelf: false,
      response: asResponse(row.response),
      stale: row.response_stale,
    }));

  // The face by the name (Adam, 2026-08-25). `event_people()` returns person
  // ids and names but no photo, so the paths come from the CALLER'S own
  // `people` read — the only kind `signPeoplePhotos` may be handed. A reader
  // whom `people` RLS does not entitle to the row gets no path and therefore
  // initials, which is the right answer rather than a failure to handle.
  const rosterPersonIds = Array.from(new Set(roster.map((row) => row.person_id)));
  const { data: rosterPhotoRows } = rosterPersonIds.length
    ? await supabase.from("people").select("id,photo_path").in("id", rosterPersonIds)
    : { data: [] as { id: string; photo_path: string | null }[] };
  const rosterPhotos = await signPeoplePhotos(rosterPhotoRows ?? []);

  const organisers = roster.filter((row) => row.is_organiser);
  const players = roster.filter((row) => !row.is_organiser);
  const accepted = players.filter((row) => row.response === "accepted");
  const declined = players.filter((row) => row.response === "declined");
  const awaiting = players.filter((row) => !row.response);

  const cancelled = detail.status === "cancelled";

  // ------------------------------------------------------------ the tabs
  // Only a fixture-mirrored event has them; anything else is the page as it
  // has always been.
  const tab = detail.fixtureId ? eventTabFrom(rawTab) : "details";
  const canManageMatch = isStaff || capabilities.isClubAdmin;

  // The header badge: the effective scoreline, which is the coach's pair when
  // they entered one and Full-Time's otherwise — `lib/scoreline.ts` owns that
  // rule and every screen asks it rather than deciding again.
  const { data: fixtureScore } = detail.fixtureId
    ? await supabase
        .from("fixtures")
        .select("is_home,home_score,away_score,coach_home_score,coach_away_score")
        .eq("id", detail.fixtureId)
        .maybeSingle()
    : { data: null };
  const headerScore = fixtureScore
    ? scorelineLabel({
        isHome: fixtureScore.is_home,
        homeScore: fixtureScore.home_score,
        awayScore: fixtureScore.away_score,
        coachHomeScore: fixtureScore.coach_home_score,
        coachAwayScore: fixtureScore.coach_away_score,
      })
    : null;

  const lineup =
    detail.fixtureId && tab === "lineup"
      ? await loadLineupSection(detail.teamId, detail.fixtureId, { canManage: canManageMatch })
      : null;

  // Editing (Adam, 2026-08-25): the team's staff and club admins, on a manual
  // event that has not been cancelled and has not happened. A fixture-mirrored
  // event is edited through its fixture — `update_team_event` says the same
  // thing to anyone who reaches the form another way.
  const canEdit =
    (isStaff || capabilities.isClubAdmin) &&
    !cancelled &&
    !detail.fixtureId &&
    new Date(detail.startsAt).getTime() > Date.now();

  return (
    <>
      <PageHeader
        title={detail.title}
        subtitle={`${detail.teamName} · ${eventTypeLabel(detail.type)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* The result, wherever it came from. The lineup used to have a
                button here (#143); it is the Line-up tab now, so the only
                fixture screen still worth a link is the availability marker —
                the staff squad panel and the day-of register. */}
            {headerScore ? (
              <Badge
                variant={
                  headerScore.outcome === "win"
                    ? "success"
                    : headerScore.outcome === "loss"
                      ? "destructive"
                      : "muted"
                }
                className="text-sm tabular-nums"
              >
                {headerScore.text}
              </Badge>
            ) : null}
            {detail.fixtureId && canManageMatch ? (
              <Link
                href={`/teams/${detail.teamId}/fixtures/${detail.fixtureId}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <ClipboardList className="h-4 w-4" /> Availability
              </Link>
            ) : null}
            {canEdit ? (
              <Link
                href={`/events/${detail.id}/edit`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Pencil className="h-4 w-4" /> Edit
              </Link>
            ) : null}
            <Link href="/events" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ArrowLeft className="h-4 w-4" /> All events
            </Link>
          </div>
        }
      />

      {detail.fixtureId ? (
        <div className="border-b bg-card px-4 pb-3 lg:px-8">
          <EventTabs eventId={detail.id} active={tab} />
        </div>
      ) : null}

      {tab === "lineup" ? (
        <div className="p-4 lg:p-6">
          {lineup ? (
            <LineupSection data={lineup} />
          ) : (
            <p className="text-sm text-muted-foreground">
              This match&apos;s lineup could not be read.
            </p>
          )}
        </div>
      ) : null}

      {tab === "stats" && detail.fixtureId ? (
        <div className="p-4 lg:p-6">
          <MatchStatsSection
            eventId={detail.id}
            teamId={detail.teamId}
            fixtureId={detail.fixtureId}
            canManage={canManageMatch}
          />
        </div>
      ) : null}

      {tab === "score" && detail.fixtureId ? (
        <div className="p-4 lg:p-6">
          <ScorelineSection
            eventId={detail.id}
            teamId={detail.teamId}
            fixtureId={detail.fixtureId}
            canManage={canManageMatch}
          />
        </div>
      ) : null}

      {tab === "details" ? (
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_20rem] lg:gap-6 lg:p-6">
        {/* ------------------------------------------------ the event itself */}
        <div className="space-y-4">
          {cancelled ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              This event has been cancelled.
            </p>
          ) : null}

          {!cancelled && detail.detailsChangedAt ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-semibold">The details have changed.</span>{" "}
              {detail.changeNote ?? "Check the time and venue below."} Answers given before the
              change still stand — update yours if it no longer holds.
            </p>
          ) : null}

          {mine.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your response</CardTitle>
                {/* Adam, 2026-08-25: replies are asked for on socials; on
                    matches and training they are welcome but never demanded. */}
                <p className="text-xs text-muted-foreground">
                  {detail.type === "social"
                    ? "Replies help the organisers plan — please answer."
                    : "Replying is optional for matches and training — the coach plans either way."}
                </p>
              </CardHeader>
              <CardContent>
                <RespondButtons eventId={detail.id} people={mine} disabled={cancelled} />
              </CardContent>
            </Card>
          ) : null}

          {canAssignPitch && pitches.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Assign a pitch</CardTitle>
              </CardHeader>
              <CardContent>
                <AssignPitch
                  eventId={detail.id}
                  pitches={pitches}
                  homeResourceId={homeResourceId}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{formatEventDate(detail.startsAt)}</span>
                <span className="text-muted-foreground">
                  {detail.meetAt ? `Meet ${formatEventTime(detail.meetAt)} · ` : ""}
                  {detail.meetAt ? "Start " : ""}
                  {formatEventTime(detail.startsAt)}
                  {detail.endsAt ? `–${formatEventTime(detail.endsAt)}` : ""}
                </span>
              </p>

              <p className="flex flex-wrap items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                {detail.venue ? (
                  <>
                    {/* The maps link prefers the venue's real address from
                        Manage venues (Adam, 2026-08-25) over its name. */}
                    <a
                      href={googleMapsUrl(detail.venueAddress ?? detail.venue)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {detail.venue}
                    </a>
                    {detail.booked ? (
                      <Badge variant="success">
                        <CircleCheck className="h-3.5 w-3.5" /> Venue booked
                      </Badge>
                    ) : detail.bookingStatus === "pending" ? (
                      <Badge variant="warning">Pitch requested — awaiting the club</Badge>
                    ) : null}
                    {detail.venueAddress ? (
                      <span className="basis-full pl-6 text-xs text-muted-foreground">
                        {detail.venueAddress}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">Venue to be confirmed</span>
                )}
              </p>

              {detail.series ? (
                <p className="flex flex-wrap items-center gap-2">
                  <Repeat className="h-4 w-4 text-muted-foreground" />
                  <span>
                    Part of a series: {detail.series.title}, weekly on {detail.series.weekday}s at{" "}
                    {detail.series.time}
                    {detail.series.repeatUntil
                      ? ` until ${formatEventDate(detail.series.repeatUntil)}`
                      : ""}{" "}
                    ({detail.series.occurrences} events)
                  </span>
                </p>
              ) : null}

              <p className="flex flex-wrap items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Created by</span>
                <span>{detail.createdByName}</span>
              </p>

              {detail.notes ? (
                <p className="whitespace-pre-line rounded-md border bg-secondary/40 px-3 py-2">
                  {detail.notes}
                </p>
              ) : null}

              {detail.fixtureId ? (
                <p className="text-xs text-muted-foreground">
                  This event mirrors a fixture — kickoff, venue and cancellation follow the
                  fixture record.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* -------------------------------------------------- who's coming */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organisers</CardTitle>
            </CardHeader>
            <CardContent>
              {rosterHidden ? (
                <p className="text-sm text-muted-foreground">
                  Responses are visible to the team, their parents and the club.
                </p>
              ) : organisers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No coaches recorded on this team.</p>
              ) : (
                <ul className="space-y-2">
                  {organisers.map((row) => (
                    <li key={row.person_id} className="flex flex-wrap items-center gap-2 text-sm">
                      <Avatar
                        name={row.full_name}
                        photoUrl={rosterPhotos.get(row.person_id) ?? null}
                        size="sm"
                      />
                      <span className="font-medium">{row.full_name}</span>
                      <Badge variant={responseVariant(asResponse(row.response))}>
                        {responseLabel(asResponse(row.response))}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {!rosterHidden ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Players</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="mb-1 font-medium text-emerald-700">Accepted ({accepted.length})</p>
                  {accepted.length === 0 ? (
                    <p className="text-muted-foreground">Nobody yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {accepted.map((row) => (
                        <li key={row.person_id} className="flex items-center gap-2">
                          <Avatar
                            name={row.full_name}
                            photoUrl={rosterPhotos.get(row.person_id) ?? null}
                            size="sm"
                          />
                          {row.full_name}
                          {row.response_stale ? (
                            <span
                              className="text-amber-700"
                              title="Answered before the details changed"
                            >
                              {" "}
                              *
                            </span>
                          ) : null}
                          {isStaff && row.note ? (
                            <span className="text-muted-foreground"> — {row.note}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-1 font-medium text-destructive">Declined ({declined.length})</p>
                  {declined.length === 0 ? (
                    <p className="text-muted-foreground">Nobody.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {declined.map((row) => (
                        <li key={row.person_id} className="flex items-center gap-2">
                          <Avatar
                            name={row.full_name}
                            photoUrl={rosterPhotos.get(row.person_id) ?? null}
                            size="sm"
                          />
                          {row.full_name}
                          {row.response_stale ? (
                            <span
                              className="text-amber-700"
                              title="Answered before the details changed"
                            >
                              {" "}
                              *
                            </span>
                          ) : null}
                          {isStaff && row.note ? (
                            <span className="text-muted-foreground"> — {row.note}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-1 font-medium">No response ({awaiting.length})</p>
                  {awaiting.length === 0 ? (
                    <p className="text-muted-foreground">Everyone has answered.</p>
                  ) : (
                    <ul className="mb-2 space-y-1.5">
                      {awaiting.map((row) => (
                        <li
                          key={row.person_id}
                          className="flex items-center gap-2 text-muted-foreground"
                        >
                          <Avatar
                            name={row.full_name}
                            photoUrl={rosterPhotos.get(row.person_id) ?? null}
                            size="sm"
                          />
                          {row.full_name}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isStaff && awaiting.length > 0 && !cancelled ? (
                    <RemindButton eventId={detail.id} />
                  ) : null}
                </div>

                {players.some((row) => row.response_stale) ? (
                  <p className="text-xs text-amber-700">
                    * answered before the details changed
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
      ) : null}
    </>
  );
}
