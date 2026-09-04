import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, Plus, Users } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Venues" };

/**
 * `/venues` — the grounds the club plays at (20260901180000).
 *
 * A venue was a naming convention until this week: a pitch called
 * "Ashton Park – Pitch 2" and a prefix everybody agreed to read as a ground.
 * It is a table now, with an address, notes for whoever arrives first, and a
 * coaches' group that fills itself from the teams who play there — and none of
 * that could be edited anywhere. This is where it is edited.
 *
 * Read through the caller's own client: `venues_public_read` returns the
 * active rows to anybody and `venues_admin_read` adds the retired ones for a
 * club administrator, so a retired ground appearing here at all is the
 * database confirming who is asking. The guard below mirrors /pitches/manage.
 */

export const dynamic = "force-dynamic";

export default async function VenuesPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/lobby");

  const supabase = await createClient();
  const [{ data: venueRows, error }, { data: pitchRows }] = await Promise.all([
    supabase
      .from("venues")
      .select("id,name,address,notes,active,sort_order")
      .order("sort_order")
      .order("name"),
    supabase
      .from("resources")
      .select("id,name,venue_id,active")
      .eq("type", "pitch")
      .order("sort_order")
      .order("name"),
  ]);

  const venues = venueRows ?? [];
  const pitches = pitchRows ?? [];

  const pitchCount = new Map<string, number>();
  for (const pitch of pitches) {
    if (!pitch.venue_id) continue;
    pitchCount.set(pitch.venue_id, (pitchCount.get(pitch.venue_id) ?? 0) + 1);
  }
  const unplaced = pitches.filter((pitch) => pitch.venue_id === null && pitch.active);

  const active = venues.filter((venue) => venue.active);
  const retired = venues.filter((venue) => !venue.active);

  return (
    <>
      <PageHeader
        title="Venues"
        subtitle="The grounds the club plays at — their addresses, what a coach needs on arrival, and which pitches are on them"
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
        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load the venues: {error.message}
          </p>
        )}

        {/* The pitches nobody has placed. Worth its own line: a pitch with no
            venue is not broken — it works and it books — but it is missing
            from its ground's coaches group, and that absence is invisible
            anywhere else. */}
        {unplaced.length > 0 && (
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
          heading={`${active.length} ${active.length === 1 ? "venue" : "venues"} in use`}
          venues={active}
          pitchCount={pitchCount}
        />

        {retired.length > 0 && (
          <VenueList
            heading="Retired"
            blurb="Kept, not deleted: their pitches, bookings and coaches groups are all exactly as they were."
            venues={retired}
            pitchCount={pitchCount}
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
};

function VenueList({
  heading,
  blurb,
  venues,
  pitchCount,
}: {
  heading: string;
  blurb?: string;
  venues: VenueRow[];
  pitchCount: Map<string, number>;
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
            No venues yet. Add the ground the club plays at and put its pitches on it.
          </p>
        ) : (
          venues.map((venue) => {
            const count = pitchCount.get(venue.id) ?? 0;
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
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={count > 0 ? "muted" : "outline"}>
                    {count} {count === 1 ? "pitch" : "pitches"}
                  </Badge>
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
