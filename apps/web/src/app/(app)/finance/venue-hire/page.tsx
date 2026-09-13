import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFinance } from "@/lib/finance";
import { createClient } from "@/lib/supabase/server";
import { shareWord, timeRange, weekdayLabel } from "@/lib/training-plan";
import { formatCurrency } from "@/lib/utils";
import { bookingCost, slotCost } from "@/lib/venue-hire";

export const metadata = { title: "Venue hire" };

export const dynamic = "force-dynamic";

/**
 * `/finance/venue-hire` — what the club pays for the venues it trains at
 * (Adam, 2026-09-13: "put price alongside the bookings slot and create a
 * report in Money for it").
 *
 * One season at a time: every booking noted against a training venue, its
 * weekly slots with the pitch, the share, the price per session, the number
 * of sessions between the booking's dates and what that comes to. Totals by
 * venue and for the season. A slot with no price is counted and flagged, not
 * quietly left out of the sum.
 *
 * The figures are what has been noted on the venue pages, nothing more:
 * this is a planning and budgeting view for the treasurer, not a ledger.
 */

/** "6 Oct 2026 – 23 Mar 2027". */
function spanLabel(startsOn: string, endsOn: string): string {
  const fmt = (date: string): string =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  return startsOn === endsOn ? fmt(startsOn) : `${fmt(startsOn)} – ${fmt(endsOn)}`;
}

export default async function VenueHireReportPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  await requireFinance();
  const { season: seasonParam } = await searchParams;
  const supabase = await createClient();

  const { data: seasonRows } = await supabase
    .from("seasons")
    .select("id,name,is_current,starts_on")
    .order("starts_on", { ascending: false });
  const seasons = seasonRows ?? [];
  const selected = seasons.find((s) => s.id === seasonParam) ?? seasons.find((s) => s.is_current) ?? seasons[0] ?? null;

  const query = supabase
    .from("venue_bookings")
    .select(
      "id,venue_id,season_id,starts_on,ends_on,reference,notes,venues(name),venue_booking_slots(id,weekday,start_time,end_time,pitch_id,parts,shares,price_pence,resources(name))",
    )
    .order("starts_on");
  const { data: bookingRows } = selected ? await query.eq("season_id", selected.id) : await query.is("season_id", null);

  type SlotView = {
    id: string;
    pitchName: string | null;
    weekday: number;
    startTime: string;
    endTime: string;
    parts: number;
    shares: number;
    pricePence: number | null;
    sessions: number;
    costPence: number | null;
  };
  type BookingView = {
    id: string;
    startsOn: string;
    endsOn: string;
    reference: string | null;
    notes: string | null;
    slots: SlotView[];
    sessions: number;
    costPence: number;
    unpricedSlots: number;
  };
  const byVenue = new Map<string, { venueId: string; name: string; bookings: BookingView[]; costPence: number; sessions: number; unpriced: number }>();

  for (const row of bookingRows ?? []) {
    const booking = { startsOn: row.starts_on, endsOn: row.ends_on };
    const slots: SlotView[] = (row.venue_booking_slots ?? [])
      .map((slot) => {
        const cost = slotCost(booking, { weekday: slot.weekday, pricePence: slot.price_pence });
        return {
          id: slot.id,
          pitchName: slot.resources?.name ?? null,
          weekday: slot.weekday,
          startTime: slot.start_time,
          endTime: slot.end_time,
          parts: slot.parts,
          shares: slot.shares,
          pricePence: slot.price_pence,
          sessions: cost.sessions,
          costPence: cost.costPence,
        };
      })
      .sort(
        (a, b) =>
          (a.pitchName ?? "").localeCompare(b.pitchName ?? "") ||
          ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) ||
          a.startTime.localeCompare(b.startTime),
      );
    const total = bookingCost({ ...booking, slots: slots.map((s) => ({ weekday: s.weekday, pricePence: s.pricePence })) });
    const view: BookingView = {
      id: row.id,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      reference: row.reference,
      notes: row.notes,
      slots,
      sessions: total.sessions,
      costPence: total.costPence,
      unpricedSlots: total.unpricedSlots,
    };
    const name = row.venues?.name ?? "Venue";
    let group = byVenue.get(row.venue_id);
    if (!group) {
      group = { venueId: row.venue_id, name, bookings: [], costPence: 0, sessions: 0, unpriced: 0 };
      byVenue.set(row.venue_id, group);
    }
    group.bookings.push(view);
    group.costPence += view.costPence;
    group.sessions += view.sessions;
    group.unpriced += view.unpricedSlots;
  }
  const groups = Array.from(byVenue.values()).sort((a, b) => a.name.localeCompare(b.name));
  const grand = groups.reduce(
    (acc, g) => ({ costPence: acc.costPence + g.costPence, sessions: acc.sessions + g.sessions, unpriced: acc.unpriced + g.unpriced }),
    { costPence: 0, sessions: 0, unpriced: 0 },
  );

  return (
    <>
      <PageHeader
        title="Venue hire"
        subtitle="What the club pays for the venues it trains at — the bookings noted on each venue's page, priced per session and added up"
        back={{ href: "/finance", label: "Finance" }}
      />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        {/* The season, as real links so the view is shareable. */}
        <div className="-mx-4 flex gap-4 overflow-x-auto border-b px-4 lg:mx-0 lg:px-0">
          {seasons.map((season) => (
            <Link
              key={season.id}
              href={`/finance/venue-hire?season=${season.id}`}
              aria-current={selected?.id === season.id ? "page" : undefined}
              className={
                "-mb-px flex min-h-[44px] shrink-0 items-center gap-2 border-b-2 pb-2.5 text-sm transition-colors lg:min-h-0 " +
                (selected?.id === season.id
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {season.name}
              {season.is_current ? <Badge variant="muted">current</Badge> : null}
            </Link>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Season total</p>
            <p className="text-2xl font-semibold tabular-nums">{formatCurrency(grand.costPence)}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Sessions booked</p>
            <p className="text-2xl font-semibold tabular-nums">{grand.sessions}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Slots without a price</p>
            <p className={"text-2xl font-semibold tabular-nums " + (grand.unpriced > 0 ? "text-amber-700" : "")}>{grand.unpriced}</p>
          </div>
        </div>

        {groups.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No venue bookings noted for {selected?.name ?? "this season"}. They are noted on each training venue&rsquo;s page under{" "}
              <Link href="/venues?tab=training" className="underline underline-offset-2">
                Venues
              </Link>
              .
            </CardContent>
          </Card>
        ) : (
          groups.map((group) => (
            <Card key={group.venueId}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 p-4 lg:p-6">
                <div>
                  <CardTitle className="text-base">
                    <Link href={`/venues/${group.venueId}`} className="hover:underline">
                      {group.name}
                    </Link>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {group.bookings.length} {group.bookings.length === 1 ? "booking" : "bookings"} · {group.sessions} sessions
                    {group.unpriced > 0 ? ` · ${group.unpriced} ${group.unpriced === 1 ? "slot" : "slots"} unpriced` : ""}
                  </p>
                </div>
                <p className="text-xl font-semibold tabular-nums">{formatCurrency(group.costPence)}</p>
              </CardHeader>
              <CardContent className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0">
                {group.bookings.map((booking) => (
                  <div key={booking.id} className="space-y-2">
                    <p className="text-sm font-medium">
                      {spanLabel(booking.startsOn, booking.endsOn)}
                      {booking.reference ? <span className="font-normal text-muted-foreground"> · ref {booking.reference}</span> : null}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="py-2 pr-3 font-medium">Pitch</th>
                            <th className="py-2 pr-3 font-medium">Slot</th>
                            <th className="py-2 pr-3 font-medium">Ours</th>
                            <th className="py-2 pr-3 text-right font-medium">A session</th>
                            <th className="py-2 pr-3 text-right font-medium">Sessions</th>
                            <th className="py-2 text-right font-medium">Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {booking.slots.map((slot) => (
                            <tr key={slot.id} className="border-b last:border-0">
                              <td className="py-2 pr-3">{slot.pitchName ?? "—"}</td>
                              <td className="py-2 pr-3">
                                {weekdayLabel(slot.weekday)} {timeRange(slot.startTime, slot.endTime)}
                              </td>
                              <td className="py-2 pr-3 capitalize">{shareWord(slot.parts, slot.shares)}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {slot.pricePence === null ? <span className="text-amber-700">unpriced</span> : formatCurrency(slot.pricePence)}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">{slot.sessions}</td>
                              <td className="py-2 text-right tabular-nums">{slot.costPence === null ? "—" : formatCurrency(slot.costPence)}</td>
                            </tr>
                          ))}
                          {booking.slots.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="py-2 text-muted-foreground">
                                No slots noted on this booking.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                        <tfoot>
                          <tr className="border-t font-medium">
                            <td colSpan={4} className="py-2 pr-3 text-right">
                              Booking
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">{booking.sessions}</td>
                            <td className="py-2 text-right tabular-nums">{formatCurrency(booking.costPence)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    {booking.notes ? <p className="whitespace-pre-line text-xs text-muted-foreground">{booking.notes}</p> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
