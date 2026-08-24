import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, CircleCheck, MapPin, Repeat, User } from "lucide-react";

import type { Json } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { RespondButtons, responseLabel, responseVariant } from "../respond-buttons";
import {
  eventTypeLabel,
  formatEventDate,
  formatEventTime,
  googleMapsUrl,
  type EventPerson,
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
  venue: string | null;
  notes: string | null;
  createdByName: string;
  booked: boolean;
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
    venue: str(record, "venue"),
    notes: str(record, "notes"),
    createdByName: str(record, "created_by_name") ?? "the club",
    booked: record["booked"] === true,
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
};

function asResponse(value: string | null): "accepted" | "declined" | null {
  return value === "accepted" || value === "declined" ? value : null;
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const { id } = await params;

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

  const mine: EventPerson[] = roster
    .filter((row) => row.can_respond)
    .map((row) => ({
      personId: row.person_id,
      name: row.full_name,
      isSelf: false,
      response: asResponse(row.response),
    }));

  const organisers = roster.filter((row) => row.is_organiser);
  const players = roster.filter((row) => !row.is_organiser);
  const accepted = players.filter((row) => row.response === "accepted");
  const declined = players.filter((row) => row.response === "declined");
  const awaiting = players.filter((row) => !row.response);

  const cancelled = detail.status === "cancelled";

  return (
    <>
      <PageHeader
        title={detail.title}
        subtitle={`${detail.teamName} · ${eventTypeLabel(detail.type)}`}
        action={
          <Link
            href="/events"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeft className="h-4 w-4" /> All events
          </Link>
        }
      />

      <div className="grid max-w-5xl gap-6 p-6 lg:grid-cols-[1fr_20rem]">
        {/* ------------------------------------------------ the event itself */}
        <div className="space-y-4">
          {cancelled ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              This event has been cancelled.
            </p>
          ) : null}

          {mine.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your response</CardTitle>
              </CardHeader>
              <CardContent>
                <RespondButtons eventId={detail.id} people={mine} disabled={cancelled} />
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
                  {formatEventTime(detail.startsAt)}
                  {detail.endsAt ? `–${formatEventTime(detail.endsAt)}` : ""}
                </span>
              </p>

              <p className="flex flex-wrap items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                {detail.venue ? (
                  <>
                    <a
                      href={googleMapsUrl(detail.venue)}
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
                    <ul className="space-y-1">
                      {accepted.map((row) => (
                        <li key={row.person_id}>
                          {row.full_name}
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
                    <ul className="space-y-1">
                      {declined.map((row) => (
                        <li key={row.person_id}>
                          {row.full_name}
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
                    <ul className="mb-2 space-y-1">
                      {awaiting.map((row) => (
                        <li key={row.person_id} className="text-muted-foreground">
                          {row.full_name}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isStaff && awaiting.length > 0 && !cancelled ? (
                    <RemindButton eventId={detail.id} />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
