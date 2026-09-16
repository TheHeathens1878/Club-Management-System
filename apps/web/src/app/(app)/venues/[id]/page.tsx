import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Archive, LandPlot, MapPin, MessageSquare, Users } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FoldCard } from "@/components/ui/fold-card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";
import { partsLabel, shareChip } from "@/lib/training-plan";
import { parseVenueSheet, venueNextAction } from "@/lib/venue-season";

import { EditVenueForm, RetireVenueForm } from "../venue-forms";
import { CoachesFold, PitchesFold } from "./venue-folds";
import { VenueGrid } from "./venue-grid";
import type { SeasonOption, VenueBookingRow } from "./types";

/**
 * `/venues/[id]` — one ground: what the club has booked here this season,
 * which pitches are on it, and who its coaches' group has in it.
 *
 * The page is the SEASON (P8.8, the makeover): a status bar saying what the
 * hire comes to and offering the one thing to do about it, then the booked
 * slots as a grid of pitch × day — the same grid the winter-training block
 * page draws, out of the same `timetableRows()`. Everything else about a
 * ground is settings, so it folds beneath.
 *
 * The coaching staff fold is the interesting half. Membership of a venue's
 * group is DERIVED (20260901190000) — every coach, assistant coach and manager
 * of an active team that plays here, by home pitch, by an allocated fixture or
 * by a training session — and adults only, strictly: SG-0 makes an unknown
 * date of birth a minor, and a minor is not admitted at all. So a coach can be
 * correctly identified as working here and still be out of the group, and the
 * only honest thing to do is say which ones and why. `venue_coaching_staff()`
 * answers exactly that question, which is why it returns `adult` and
 * `in_group` as separate columns.
 */

export const dynamic = "force-dynamic";

export default async function VenuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sheet?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/lobby");

  const { id } = await params;
  const { sheet } = await searchParams;
  const supabase = await createClient();

  const { data: venue } = await supabase
    .from("venues")
    .select("id,name,address,notes,active,sort_order,for_matches,for_training,training_parts,training_shares,training_notes")
    .eq("id", id)
    .maybeSingle();
  if (!venue) notFound();

  const [{ data: pitchRows }, { data: groupId }, { data: staffRows }, { data: bookingRows }, { data: seasonRows }, { data: breakRows }] =
    await Promise.all([
    supabase
      .from("resources")
      .select("id,name,active,venue_id,for_matches,for_training,venues(name)")
      .eq("type", "pitch")
      .order("sort_order")
      .order("name"),
    supabase.rpc("venue_coaches_group_id", { p_venue_id: id }),
    supabase.rpc("venue_coaching_staff", { p_venue_id: id }),
    // The bookings, season by season (20260913130000) — a training-venue
    // concern, but read for every venue: a match ground the club also hires
    // for winter training is both.
    supabase
      .from("venue_bookings")
      .select("id,season_id,starts_on,ends_on,reference,notes,seasons(name,is_current,starts_on),venue_booking_slots(id,weekday,start_time,end_time,pitch_id,parts,shares,price_pence,resources(name))")
      .eq("venue_id", id)
      .order("starts_on", { ascending: false }),
    supabase.from("seasons").select("id,name,is_current").order("starts_on", { ascending: false }),
    // Dates off the venue does not charge for, from every block that lists it.
    supabase
      .from("training_blackouts")
      .select("starts_on,ends_on,training_blocks!inner(training_block_venues!inner(venue_id))")
      .eq("charged", false)
      .eq("training_blocks.training_block_venues.venue_id", id),
  ]);

  const pitches = pitchRows ?? [];
  const here = pitches.filter((pitch) => pitch.venue_id === id);
  const elsewhere = pitches
    .filter((pitch) => pitch.venue_id !== id && pitch.active)
    .map((pitch) => ({ id: pitch.id, name: pitch.name, currentVenue: pitch.venues?.name ?? null }));

  const staff = staffRows ?? [];
  const staffNames = await resolveNames(staff.map((row) => row.person_id));
  const inGroup = staff.filter((row) => row.in_group);
  const waiting = staff.filter((row) => !row.in_group);

  // Current season first, then newest; a booking with no season last.
  const bookings: VenueBookingRow[] = (bookingRows ?? [])
    .map((row) => ({
      id: row.id,
      seasonId: row.season_id,
      seasonName: row.seasons?.name ?? null,
      seasonStartsOn: row.seasons?.starts_on ?? "",
      seasonCurrent: row.seasons?.is_current ?? false,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      reference: row.reference,
      notes: row.notes,
      slots: (row.venue_booking_slots ?? []).map((slot) => ({
        id: slot.id,
        weekday: slot.weekday,
        startTime: slot.start_time,
        endTime: slot.end_time,
        pitchId: slot.pitch_id,
        pitchName: slot.resources?.name ?? null,
        parts: slot.parts,
        shares: slot.shares,
        pricePence: slot.price_pence,
      })),
    }))
    .sort(
      (a, b) =>
        Number(b.seasonCurrent) - Number(a.seasonCurrent) ||
        b.seasonStartsOn.localeCompare(a.seasonStartsOn) ||
        a.startsOn.localeCompare(b.startsOn),
    );
  const seasons: SeasonOption[] = (seasonRows ?? []).map((s) => ({ id: s.id, name: s.name, isCurrent: s.is_current }));
  const current = seasons.find((season) => season.isCurrent) ?? null;
  const uncharged = (breakRows ?? []).map((b) => ({ startsOn: b.starts_on, endsOn: b.ends_on }));
  const action = venueNextAction(venue, bookings, current, uncharged);

  // The folds' closed summaries: real text, worked out here rather than
  // "3 items" — a row nobody has to open to learn something from.
  const usedFor =
    venue.for_matches && venue.for_training
      ? "matches & training"
      : venue.for_matches
        ? "matches"
        : venue.for_training
          ? "training"
          : "not offered for either";
  const share =
    venue.training_parts > 1
      ? `pitch in ${partsLabel(venue.training_parts).toLowerCase()}, ${
          venue.training_shares >= venue.training_parts
            ? "all of it"
            : shareChip(venue.training_shares, venue.training_parts)
        } ours`
      : null;
  const groundSummary = [venue.address || "No address recorded", usedFor, share].filter(Boolean).join(" · ");
  const pitchSummary =
    here.length === 0 ? "None yet — nothing links a team to this ground" : here.map((pitch) => pitch.name).join(" · ");
  const coachSummary =
    staff.length === 0
      ? "Nobody yet — a coach joins when a team of theirs plays here"
      : `${inGroup.length} in the group${
          waiting.length > 0
            ? ` · ${waiting.length === 1 ? "1 waiting on a date of birth" : `${waiting.length} waiting on a date of birth`}`
            : ""
        }`;

  return (
    <>
      <PageHeader
        title={venue.name}
        subtitle={venue.address || "No address recorded"}
        action={
          groupId ? (
            <Link href={`/messages/${groupId}`} className={buttonVariants({ variant: "outline", size: "sm" }) + " gap-1.5"}>
              <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Coaches group
            </Link>
          ) : undefined
        }
        back={{ href: "/venues", label: "Venues" }}
      />

      <div className="space-y-4 p-4 lg:p-6">
        {!venue.active ? (
          <Callout tone="warning" title="This venue is retired">
            Its pitches still book and its coaches group is still readable — nothing here was
            deleted, and bringing it back into use is one button in the last fold below.
          </Callout>
        ) : null}

        {venue.for_training || bookings.length > 0 ? (
          <VenueGrid
            venueId={venue.id}
            venueName={venue.name}
            action={action}
            bookings={bookings}
            seasons={seasons}
            pitches={here.filter((pitch) => pitch.active).map((pitch) => ({ id: pitch.id, name: pitch.name }))}
            uncharged={uncharged}
            currentSeasonId={current?.id ?? null}
            initialSheet={parseVenueSheet(sheet)}
          />
        ) : null}

        <div className="space-y-2 pt-2">
          <FoldCard icon={<MapPin className="h-4 w-4" aria-hidden />} title="The ground" summary={groundSummary}>
            <EditVenueForm
              venueId={venue.id}
              values={{
                name: venue.name,
                address: venue.address,
                notes: venue.notes,
                sortOrder: venue.sort_order,
                forMatches: venue.for_matches,
                forTraining: venue.for_training,
                trainingParts: venue.training_parts,
                trainingShares: venue.training_shares,
                trainingNotes: venue.training_notes,
              }}
            />
          </FoldCard>

          <FoldCard
            icon={<LandPlot className="h-4 w-4" aria-hidden />}
            title={`Pitches on this ground (${here.length})`}
            summary={pitchSummary}
          >
            <PitchesFold
              venueId={venue.id}
              forTraining={venue.for_training}
              forMatches={venue.for_matches}
              here={here}
              elsewhere={elsewhere}
            />
          </FoldCard>

          <FoldCard
            icon={<Users className="h-4 w-4" aria-hidden />}
            title={`Coaches here (${inGroup.length})`}
            summary={coachSummary}
          >
            <CoachesFold inGroup={inGroup} waiting={waiting} names={staffNames} />
          </FoldCard>

          <FoldCard
            icon={<Archive className="h-4 w-4" aria-hidden />}
            title="Retire this venue"
            summary={venue.active ? "In use — retiring keeps the room, the history and the address" : "Retired — one button brings it back"}
          >
            <RetireVenueForm venueId={venue.id} active={venue.active} />
          </FoldCard>
        </div>
      </div>
    </>
  );
}
