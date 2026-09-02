import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus, ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { isMemberView, resolveRoleView } from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";

import { RespondButtons } from "./respond-buttons";
import {
  eventTypeLabel,
  formatEventDate,
  formatEventTime,
  parseEventPeople,
} from "./shared";

/**
 * Events — every upcoming occasion for the teams the signed-in person belongs
 * to, is staff of, or has a child on (Adam, 2026-08-24). A fixture appears
 * here automatically the moment it is created; practices and socials are
 * coach-created. Accept/decline is inline for everyone the viewer answers
 * for; the full picture (organisers, who's in, who hasn't said) is the event
 * page.
 *
 * `my_events()` is SECURITY DEFINER and does all the scoping — this page adds
 * nothing to what the database already decided the caller may see.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Events" };

const HORIZON_DAYS = 90;

export default async function EventsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const [supabase, capabilities] = await Promise.all([createClient(), getCapabilities()]);
  const { data, error } = await supabase.rpc("my_events", { p_horizon_days: HORIZON_DAYS });

  // "Viewing as Coach – U14 Mavericks" narrows the list to that team; the
  // scope is the validated cookie, so a stale team silently widens back.
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const scope = await getTeamScope(view, capabilities);

  const events = (data ?? []).filter((event) => !scope || event.team_id === scope.id);
  // "New event" is a coach's or an administrator's button, and only while
  // they are wearing that hat (Adam, 2026-09-02). In a member view the list is
  // what every other parent sees: what is on, and nothing to run.
  const canCreate =
    (capabilities.isTeamStaff || capabilities.isClubAdmin) && !isMemberView(view);

  return (
    <>
      <PageHeader
        title="Events"
        subtitle={
          scope
            ? `Matches, practices and socials for ${scope.name} — accept or decline`
            : "Matches, practices and socials for your teams — accept or decline"
        }
        action={
          canCreate ? (
            <Link href="/events/new" className={buttonVariants({ size: "sm" })}>
              <CalendarPlus className="h-4 w-4" /> New event
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load your events: {error.message}
          </p>
        ) : null}

        {events.length === 0 && !error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nothing coming up</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No events in the next {HORIZON_DAYS} days for your teams. Fixtures appear here
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
