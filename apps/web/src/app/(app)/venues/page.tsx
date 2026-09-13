import Link from "next/link";
import { redirect } from "next/navigation";
import { Dumbbell, MapPin, Plus, Shirt, Users } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";
import { blackoutLabel, shareChip, weekdayLabel } from "@/lib/training-plan";

export const metadata = { title: "Venues" };

/**
 * `/venues` — the grounds the club plays at, and the ones it trains at
 * (20260901180000; training venues 20260913110000).
 *
 * Two tabs, one table. "Match venues" are the grounds with our pitches and
 * the central venues; "Training venues" are the hired 3Gs and school pitches
 * the winter blocks are planned at (Adam, 2026-09-13: "the venues in Training
 * Blocks should be visible in Venues, under a training venues tab — so we
 * have training / matches, some can be both"). A venue can be on both tabs.
 *
 * Read through the caller's own client: `venues_public_read` returns the
 * active rows to anybody and `venues_admin_read` adds the retired ones for a
 * club administrator, so a retired ground appearing here at all is the
 * database confirming who is asking. The guard below mirrors /pitches/manage.
 */

export const dynamic = "force-dynamic";

type Tab = "matches" | "training";

export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/lobby");

  const { tab: tabParam } = await searchParams;
  const tab: Tab = tabParam === "training" ? "training" : "matches";

  const supabase = await createClient();
  const [{ data: venueRows, error }, { data: pitchRows }, { data: slotRows }, { data: bookingRows }] = await Promise.all([
    supabase
      .from("venues")
      .select("id,name,address,notes,active,sort_order,for_matches,for_training,training_parts,training_shares,training_notes")
      .order("sort_order")
      .order("name"),
    supabase
      .from("resources")
      .select("id,name,venue_id,active")
      .eq("type", "pitch")
      .order("sort_order")
      .order("name"),
    supabase.from("training_slots").select("venue_id"),
    supabase
      .from("venue_bookings")
      .select("venue_id,starts_on,ends_on,seasons(is_current),venue_booking_slots(weekday)")
      .order("starts_on"),
  ]);

  const venues = venueRows ?? [];
  const pitches = pitchRows ?? [];

  const pitchCount = new Map<string, number>();
  for (const pitch of pitches) {
    if (!pitch.venue_id) continue;
    pitchCount.set(pitch.venue_id, (pitchCount.get(pitch.venue_id) ?? 0) + 1);
  }
  const slotCount = new Map<string, number>();
  for (const slot of slotRows ?? []) {
    if (!slot.venue_id) continue;
    slotCount.set(slot.venue_id, (slotCount.get(slot.venue_id) ?? 0) + 1);
  }
  const unplaced = pitches.filter((pitch) => pitch.venue_id === null && pitch.active);
  // This season's booking span per venue — the earliest start and latest end
  // of its bookings in the current season, so the tab says "Booked 6 Oct – 23 Mar".
  const booked = new Map<string, { startsOn: string; endsOn: string; days: Set<number> }>();
  for (const row of bookingRows ?? []) {
    if (!row.seasons?.is_current) continue;
    const days = (row.venue_booking_slots ?? []).map((slot) => slot.weekday);
    const span = booked.get(row.venue_id);
    if (!span) booked.set(row.venue_id, { startsOn: row.starts_on, endsOn: row.ends_on, days: new Set(days) });
    else {
      if (row.starts_on < span.startsOn) span.startsOn = row.starts_on;
      if (row.ends_on > span.endsOn) span.endsOn = row.ends_on;
      for (const day of days) span.days.add(day);
    }
  }

  const onTab = venues.filter((venue) => (tab === "training" ? venue.for_training : venue.for_matches));
  const active = onTab.filter((venue) => venue.active);
  const retired = onTab.filter((venue) => !venue.active);
  const matchCount = venues.filter((venue) => venue.for_matches && venue.active).length;
  const trainingCount = venues.filter((venue) => venue.for_training && venue.active).length;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "matches", label: "Match venues", count: matchCount },
    { key: "training", label: "Training venues", count: trainingCount },
  ];

  return (
    <>
      <PageHeader
        title="Venues"
        subtitle="The grounds the club plays at and trains at — their addresses, what a coach needs on arrival, and which pitches are on them"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/pitches/manage"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Manage pitches
            </Link>
            <Link href="/venues/new" className={buttonVariants({ size: "sm" })}>
              <Plus className="h-4 w-4" /> Add a venue
            </Link>
          </div>
        }
      />

      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        {/* The two tabs: real links, so the view is shareable and the back
            button works. */}
        <div className="-mx-4 flex gap-4 overflow-x-auto border-b px-4 lg:mx-0 lg:px-0">
          {tabs.map((item) => (
            <Link
              key={item.key}
              href={item.key === "matches" ? "/venues" : `/venues?tab=${item.key}`}
              aria-current={item.key === tab ? "page" : undefined}
              className={
                "-mb-px flex min-h-[44px] shrink-0 items-center gap-2 border-b-2 pb-2.5 text-sm transition-colors lg:min-h-0 " +
                (item.key === tab
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {item.key === "matches" ? (
                <Shirt className="h-4 w-4" aria-hidden />
              ) : (
                <Dumbbell className="h-4 w-4" aria-hidden />
              )}
              {item.label}
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">
                {item.count}
              </span>
            </Link>
          ))}
        </div>

        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load the venues: {error.message}
          </p>
        )}

        {/* The pitches nobody has placed. Worth its own line: a pitch with no
            venue is not broken — it works and it books — but it is missing
            from its ground's coaches group, and that absence is invisible
            anywhere else. A match-venue concern, so the match tab's. */}
        {tab === "matches" && unplaced.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardContent className="space-y-1 p-4 text-sm">
              <p className="font-medium text-amber-900">
                {unplaced.length === 1
                  ? "One pitch is not on a venue"
                  : `${unplaced.length} pitches are not on a venue`}
              </p>
              <p className="text-amber-900/80">
                {unplaced.map((pitch) => pitch.name).join(", ")}. They still book normally — but no
                coaches&rsquo; group knows about them, because a group belongs to a ground. Open the
                ground below and add them.
              </p>
            </CardContent>
          </Card>
        )}

        <VenueList
          tab={tab}
          heading={`${active.length} ${tab === "training" ? "training" : "match"} ${active.length === 1 ? "venue" : "venues"} in use`}
          blurb={
            tab === "training"
              ? "The hired 3Gs and school pitches the winter blocks are planned at. A venue a training slot names appears here on its own; tick “Training” on any other venue to plan sessions there."
              : undefined
          }
          venues={active}
          pitchCount={pitchCount}
          slotCount={slotCount}
          booked={booked}
        />

        {retired.length > 0 && (
          <VenueList
            tab={tab}
            heading="Retired"
            blurb="Kept, not deleted: their pitches, bookings and coaches groups are all exactly as they were."
            venues={retired}
            pitchCount={pitchCount}
            slotCount={slotCount}
            booked={booked}
          />
        )}
      </div>
    </>
  );
}

type VenueRow = {
  id: string;
  name: string;
  address: string | null;
  notes: string | null;
  active: boolean;
  sort_order: number;
  for_matches: boolean;
  for_training: boolean;
  training_parts: number;
  training_shares: number;
  training_notes: string | null;
};

function VenueList({
  tab,
  heading,
  blurb,
  venues,
  pitchCount,
  slotCount,
  booked,
}: {
  tab: Tab;
  heading: string;
  blurb?: string;
  venues: VenueRow[];
  pitchCount: Map<string, number>;
  slotCount: Map<string, number>;
  booked: Map<string, { startsOn: string; endsOn: string; days: Set<number> }>;
}) {
  return (
    <Card>
      <CardHeader className="p-4 lg:p-6">
        <CardTitle className="text-base">{heading}</CardTitle>
        {blurb && <p className="text-sm text-muted-foreground">{blurb}</p>}
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0 lg:p-6 lg:pt-0">
        {venues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tab === "training"
              ? "No training venues yet. Add a slot to a training block and its venue appears here, or add a venue and tick “Training”."
              : "No venues yet. Add the ground the club plays at and put its pitches on it."}
          </p>
        ) : (
          venues.map((venue) => {
            const pitchesHere = pitchCount.get(venue.id) ?? 0;
            const slotsHere = slotCount.get(venue.id) ?? 0;
            const span = booked.get(venue.id);
            return (
              <Link
                key={venue.id}
                href={`/venues/${venue.id}`}
                className="flex min-h-[44px] flex-wrap items-start justify-between gap-2 rounded-lg border p-3 transition hover:border-primary/40 hover:bg-secondary"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{venue.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {venue.address || "No address recorded"}
                  </p>
                  {tab === "training" && venue.training_notes ? (
                    <p className="mt-1 text-xs text-muted-foreground">{venue.training_notes}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {venue.for_matches && venue.for_training ? (
                    <Badge variant="outline">Matches &amp; training</Badge>
                  ) : null}
                  {tab === "training" ? (
                    <>
                      <Badge variant="outline">
                        {venue.training_parts <= 1 || venue.training_shares >= venue.training_parts
                          ? "Whole pitch ours"
                          : `${shareChip(venue.training_shares, venue.training_parts)} of the pitch ours`}
                      </Badge>
                      <Badge variant={slotsHere > 0 ? "muted" : "outline"}>
                        {slotsHere} {slotsHere === 1 ? "training slot" : "training slots"}
                      </Badge>
                      <Badge variant={span ? "success" : "outline"}>
                        {span
                          ? `Booked ${blackoutLabel(span.startsOn, span.endsOn)}${
                              span.days.size > 0
                                ? ` · ${[1, 2, 3, 4, 5, 6, 0].filter((d) => span.days.has(d)).map((d) => weekdayLabel(d, true)).join(", ")}`
                                : ""
                            }`
                          : "No booking this season"}
                      </Badge>
                    </>
                  ) : (
                    <Badge variant={pitchesHere > 0 ? "muted" : "outline"}>
                      {pitchesHere} {pitchesHere === 1 ? "pitch" : "pitches"}
                    </Badge>
                  )}
                  <Badge variant="outline" className="gap-1">
                    <Users className="h-3 w-3" /> Coaches group
                  </Badge>
                  {!venue.active && <Badge variant="outline">Retired</Badge>}
                </div>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
