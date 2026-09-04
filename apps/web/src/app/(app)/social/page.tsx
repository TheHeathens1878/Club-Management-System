import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities } from "@/lib/capabilities";
import { formatEventDate, formatEventTime } from "@/app/(app)/events/shared";
import { createClient } from "@/lib/supabase/server";

/**
 * Social — the club's occasions (spec §2). The next one leads the page with
 * its reply arithmetic; the rest follow as cards. Everything clicks through to
 * the event page, where accept/decline, the reply lists and the staff Remind
 * button already live.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Social" };

export default async function SocialPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const [supabase, capabilities] = await Promise.all([createClient(), getCapabilities()]);
  const { data, error } = await supabase.rpc("social_events", { p_limit: 12 });
  const events = data ?? [];
  const [hero, ...rest] = events;
  const canCreate = capabilities.isTeamStaff || capabilities.isClubAdmin;

  return (
    <>
      <PageHeader
        title="Social"
        subtitle={
          events.length > 0
            ? `${events.length} event${events.length === 1 ? "" : "s"} open for replies`
            : "The club's occasions — quiz nights, presentations, open days"
        }
        action={
          canCreate ? (
            <Link
              href="/events/new"
              className={buttonVariants({ size: "sm" }) + " min-h-[44px] lg:min-h-0"}
            >
              <CalendarPlus className="h-4 w-4" /> Create an event
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load the socials: {error.message}
          </p>
        ) : null}

        {!hero ? (
          <Card>
            <CardContent className="px-5 py-10 text-center text-sm text-muted-foreground">
              Nothing on the social calendar yet
              {canCreate ? " — “Create an event” with the Social type starts one." : "."}
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            {/* Below md the two halves stack: the occasion, then its reply
                arithmetic underneath. */}
            <div className="grid md:grid-cols-[3fr_2fr]">
              <div className="p-5 lg:p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  {formatEventDate(hero.starts_at)} · {formatEventTime(hero.starts_at)}
                  {hero.venue ? ` · ${hero.venue}` : ""}
                </p>
                <h2 className="mt-2 text-xl font-bold lg:text-2xl">{hero.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{hero.team_name}</p>
                {hero.notes ? (
                  <p className="mt-3 max-w-prose whitespace-pre-line text-sm">{hero.notes}</p>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link
                    href={`/events/${hero.event_id}?from=/social`}
                    className={
                      buttonVariants({ size: "sm" }) + " min-h-[44px] w-full lg:min-h-0 lg:w-auto"
                    }
                  >
                    Reply on the event page
                  </Link>
                  {hero.can_manage ? (
                    <Link
                      href={`/events/${hero.event_id}?from=/social`}
                      className={
                        buttonVariants({ variant: "outline", size: "sm" }) +
                        " min-h-[44px] w-full lg:min-h-0 lg:w-auto"
                      }
                    >
                      Manage · remind the quiet ones
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="border-t bg-secondary/30 p-5 md:border-l md:border-t-0 lg:p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Replies
                </p>
                <p className="mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-bold tracking-tight">{hero.accepted}</span>
                  <span className="text-sm text-muted-foreground">of {hero.squad} asked</span>
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{
                      width: `${hero.squad > 0 ? Math.min(100, Math.round((hero.accepted / hero.squad) * 100)) : 0}%`,
                    }}
                  />
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Attending</dt>
                    <dd className="font-semibold">{hero.accepted}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Can&apos;t make it</dt>
                    <dd className="font-semibold">{hero.declined}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">No reply</dt>
                    <dd className="font-semibold">
                      {Math.max(hero.squad - hero.accepted - hero.declined, 0)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </Card>
        )}

        {/* The rest: one up on a phone, then two and three as the screen allows. */}
        {rest.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {rest.map((event) => (
              <Link
                key={event.event_id}
                href={`/events/${event.event_id}?from=/social`}
                className="group block min-h-[44px]"
              >
                <Card className="h-full transition group-hover:border-primary/40">
                  <CardContent className="p-4 lg:p-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {formatEventDate(event.starts_at)} · {formatEventTime(event.starts_at)}
                    </p>
                    <p className="mt-2 font-semibold group-hover:underline">{event.title}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {event.notes ?? event.team_name}
                    </p>
                    <p className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{event.accepted} attending</span>
                      <Badge variant="outline">{event.venue ?? event.team_name}</Badge>
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
