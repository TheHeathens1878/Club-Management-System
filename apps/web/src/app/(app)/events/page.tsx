import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, CalendarPlus, ChevronRight, LandPlot } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { isMemberView, resolveRoleView, type TeamRef } from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";

import { RespondButtons } from "./respond-buttons";
import {
  eventTypeLabel,
  formatEventDate,
  formatEventTime,
  parseEventPeople,
} from "./shared";

/**
 * Calendar (P7.2) — every upcoming occasion for the teams the signed-in
 * person belongs to, is staff of, or has a child on. A fixture appears here
 * automatically the moment it is created; practices and socials are
 * coach-created. Accept/decline is inline for everyone the viewer answers
 * for; the full picture is the event page.
 *
 * ALL OF THE HOUSEHOLD BY DEFAULT. The list used to be narrowed by the
 * switcher's team cookie, so a parent who had last opened one child's team
 * saw only that child's Saturday and no way to widen it. The whole diary is
 * now the default — "view all children's fixtures" is one tap — and the
 * `?team=` chips narrow it, visibly and reversibly, in the URL.
 *
 * `my_events()` is SECURITY DEFINER and does all the scoping — this page adds
 * nothing to what the database already decided the caller may see.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Calendar" };

const HORIZON_DAYS = 90;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const [supabase, capabilities, { team: teamParam }] = await Promise.all([
    createClient(),
    getCapabilities(),
    searchParams,
  ]);
  const { data, error } = await supabase.rpc("my_events", { p_horizon_days: HORIZON_DAYS });

  // The chips: every team any hat touches, once, alphabetically.
  const teams = new Map<string, TeamRef>();
  for (const team of [...capabilities.parentTeams, ...capabilities.staffTeams, ...capabilities.playerTeams]) {
    if (!teams.has(team.id)) teams.set(team.id, team);
  }
  const chips = [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
  const filter = teamParam && teams.has(teamParam) ? teams.get(teamParam)! : null;

  const all = data ?? [];
  const events = filter ? all.filter((event) => event.team_id === filter.id) : all;

  // "New event" is a coach's or an administrator's button, and only while
  // they are wearing that hat (Adam, 2026-09-02). In a member view the list is
  // what every other parent sees: what is on, and nothing to run.
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const canCreate = (capabilities.isTeamStaff || capabilities.isClubAdmin) && !isMemberView(view);
  const canSeePitches =
    capabilities.isTeamStaff ||
    capabilities.isGuardian ||
    capabilities.hasPlayerMembership ||
    capabilities.isCommittee ||
    capabilities.isClubAdmin;

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={
          filter
            ? `Matches, practices and socials for ${filter.name} — accept or decline`
            : "Matches, practices and socials for everyone in your household — accept or decline"
        }
        action={
          canCreate ? (
            <Link href="/events/new" className={buttonVariants({ size: "sm" }) + " min-h-[44px] lg:min-h-0"}>
              <CalendarPlus className="h-4 w-4" /> New event
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {/* Which team, and the other diaries — one strip, scrollable on a phone. */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
          {chips.length > 1 ? (
            <>
              <Chip href="/events" active={!filter}>
                Everyone
              </Chip>
              {chips.map((team) => (
                <Chip key={team.id} href={`/events?team=${team.id}`} active={filter?.id === team.id}>
                  {team.name}
                </Chip>
              ))}
              <span className="w-px flex-none self-stretch bg-border" aria-hidden />
            </>
          ) : null}
          {canSeePitches ? (
            <Chip href="/pitches/calendar">
              <LandPlot className="h-3.5 w-3.5" aria-hidden /> Pitch calendar
            </Chip>
          ) : null}
          <Chip href="/social">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Socials
          </Chip>
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load your calendar: {error.message}
          </p>
        ) : null}

        {events.length === 0 && !error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nothing coming up</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No events in the next {HORIZON_DAYS} days
                {filter ? ` for ${filter.name}` : " for your teams"}. Fixtures appear here
                automatically as soon as they are created
                {canCreate ? ", and you can add practices and socials with “New event”" : ""}.
              </p>
            </CardContent>
          </Card>
        ) : (
          events.map((event) => {
            const people = parseEventPeople(event.people);
            const cancelled = event.status === "cancelled";
            return (
              <Card key={event.event_id} className={cancelled ? "opacity-70" : undefined}>
                <CardContent className="space-y-3 p-4">
                  <Link
                    href={`/events/${event.event_id}`}
                    className="group flex flex-wrap items-center gap-2"
                  >
                    <span className="text-sm font-semibold group-hover:underline">
                      {event.title}
                    </span>
                    <Badge variant="outline">{event.team_name}</Badge>
                    <Badge variant="muted">{eventTypeLabel(event.type)}</Badge>
                    {cancelled ? <Badge variant="destructive">Cancelled</Badge> : null}
                    {!cancelled && event.details_changed_at ? (
                      <Badge variant="warning">Details changed</Badge>
                    ) : null}
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <ChevronRight className="h-3.5 w-3.5" /> Details
                    </span>
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {formatEventDate(event.starts_at)} · {formatEventTime(event.starts_at)}
                    {event.ends_at ? `–${formatEventTime(event.ends_at)}` : ""}
                    {event.venue ? ` · ${event.venue}` : ""}
                  </p>
                  <RespondButtons
                    eventId={event.event_id}
                    people={people}
                    disabled={cancelled}
                  />
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}

function Chip({
  href,
  active = false,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        "inline-flex min-h-[36px] flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors " +
        (active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-card text-foreground hover:bg-secondary")
      }
    >
      {children}
    </Link>
  );
}
