import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { BookClient } from "./book-client";
import { parseExtrasConfig } from "@/lib/booking-extras";
import { standardHireSentence } from "@/lib/room-pricing";
import { formatCurrency } from "@/lib/utils";
import { Users, Clock, Info } from "lucide-react";
import { addDays, instantsToLocalWindow, localToInstant, londonToday } from "@/lib/booking-time";
import { FUNCTION_ROOM } from "@/lib/booking-types";

export const dynamic = "force-dynamic";

export default async function BookPage() {
  const admin = createAdminClient();
  const settings = await getSettings();

  const { data: rooms } = await admin
    .from("resources")
    .select("id, name, description, capacity, price_pence_per_hour, price_pence_half_day, price_pence_full_day, price_pence_fixed, price_note, extras_config, standard_price_pence, standard_hours, extra_hour_pence")
    .eq("type", FUNCTION_ROOM)
    .eq("active", true)
    .order("sort_order");

  // For the club-family discount claim: the child's team, picked from the
  // club's real team names (they are public — the recruitment page lists
  // them), but free text is still allowed.
  const { data: teamRows } = await admin
    .from("teams")
    .select("name")
    .eq("active", true)
    .order("name");

  const { data: faqRows } = await admin
    .from("faqs")
    .select("id, question, answer")
    .eq("active", true)
    .order("sort_order")
    .order("created_at");

  // Availability is shown three London months ahead. The period is
  // timestamptz, so the cut-off is midnight London at the start of the day
  // after the last date we want.
  const threeMonthsOut = new Date();
  threeMonthsOut.setMonth(threeMonthsOut.getMonth() + 3);
  const lastDate = londonToday(threeMonthsOut);

  // Function-room slots only: `bookings` also holds every pitch booking
  // (fixtures, training), which are no business of the room availability grid.
  const { data: rawBookings } = await admin
    .from("bookings")
    .select("resource_id, starts_at, ends_at")
    .in(
      "resource_id",
      (rooms ?? []).map((room) => room.id),
    )
    .in("status", ["pending", "confirmed"])
    .lt("starts_at", localToInstant(addDays(lastDate, 1), "00:00"));

  const roomList = (rooms ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    capacity: r.capacity ?? null,
    price_pence_per_hour: r.price_pence_per_hour ?? null,
    price_pence_half_day: r.price_pence_half_day ?? null,
    price_pence_full_day: r.price_pence_full_day ?? null,
    price_pence_fixed: r.price_pence_fixed,
    price_note: r.price_note,
    standard_price_pence: r.standard_price_pence ?? null,
    standard_hours: r.standard_hours ?? null,
    extra_hour_pence: r.extra_hour_pence ?? null,
    extras: parseExtrasConfig(r.extras_config).filter((extra) => extra.active),
  }));

  const faqs = (faqRows ?? []).map((f) => ({
    id: f.id,
    question: f.question,
    answer: f.answer,
  }));

  const bookedSlots = (rawBookings ?? []).map((b) => {
    const window = instantsToLocalWindow(b.starts_at, b.ends_at);
    return {
      resource_id: b.resource_id,
      date: window.date,
      start_time: window.startTime,
      end_time: window.endTime,
    };
  });

  const contactEmail = settings.contact_email || "bookings@aomsportsclub.co.uk";

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-accent/10">
      <div className="mx-auto max-w-4xl px-0 sm:px-4 py-6 sm:py-12">
        {/* Header */}
        <div className="mb-10 text-center">
          {settings.logo_url ? (
            <div className="mb-5 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={settings.logo_url}
                alt={settings.logo_alt || "Club logo"}
                style={{
                  height: Math.min(Number(settings.logo_height) || 80, 120),
                  maxWidth: Number(settings.logo_max_width) || 300,
                  objectFit: (settings.logo_object_fit as "contain" | "cover" | "fill") || "contain",
                }}
              />
            </div>
          ) : (
            <div className="mb-4 inline-flex items-center justify-center rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
              {settings.club_name}
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Function Room Hire</h1>
          <p className="mt-3 text-base text-muted-foreground max-w-xl mx-auto">
            {settings.club_description || "Our function rooms are available to hire for private events, parties, meetings and celebrations."}
          </p>
        </div>

        {/* Room cards */}
        <div className="mb-10 grid gap-4 sm:grid-cols-2">
          {roomList.map((room) => (
            <div key={room.id} className="rounded-xl border bg-card p-6 shadow-sm">
              <h2 className="text-lg font-semibold">{room.name}</h2>
              {room.description && (
                <p className="mt-1 text-sm text-muted-foreground">{room.description}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-4 text-sm">
                {room.capacity && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    Up to {room.capacity} guests
                  </span>
                )}
              </div>
              {(standardHireSentence(room) || room.price_pence_fixed || room.price_pence_per_hour || room.price_pence_half_day || room.price_pence_full_day) && (
                <div className="mt-4 space-y-1 border-t pt-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Pricing</p>
                  {standardHireSentence(room) && (
                    <p className="flex items-start gap-1.5 text-sm font-medium">
                      <Clock className="h-3.5 w-3.5 shrink-0 mt-1 text-muted-foreground" />
                      {standardHireSentence(room)}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    {!standardHireSentence(room) && room.price_pence_fixed && (
                      <span className="flex items-center gap-1.5 font-medium">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        {formatCurrency(room.price_pence_fixed)}
                      </span>
                    )}
                    {room.price_pence_per_hour && (
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        {formatCurrency(room.price_pence_per_hour)}/hour
                      </span>
                    )}
                    {room.price_pence_half_day && (
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        {formatCurrency(room.price_pence_half_day)} half day
                      </span>
                    )}
                    {room.price_pence_full_day && (
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        {formatCurrency(room.price_pence_full_day)} full day
                      </span>
                    )}
                  </div>
                  {room.price_note && (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground mt-2">
                      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {room.price_note}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Availability calendar + booking form */}
        <div className="overflow-hidden rounded-none border-y sm:rounded-xl sm:border bg-card sm:shadow-sm">
          <div className="px-4 pt-5 pb-3 sm:px-6 sm:pt-6 sm:pb-0">
            <h2 className="mb-1 text-xl font-semibold">Check availability &amp; request a booking</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Select a room, browse the calendar, then click a date to fill in your details.
            </p>
          </div>
          <div className="px-0 pb-0 sm:px-6 sm:pb-6">
            {roomList.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No rooms are currently available. Please contact us directly.
              </p>
            ) : (
              <BookClient rooms={roomList} bookedSlots={bookedSlots} teamNames={(teamRows ?? []).map((t) => t.name)} />
            )}
          </div>
        </div>

        {/* FAQs */}
        {faqs.length > 0 && (
          <div className="mt-10">
            <h2 className="text-xl font-semibold mb-4">Frequently asked questions</h2>
            <div className="space-y-2">
              {faqs.map((faq) => (
                <details key={faq.id} className="group rounded-lg border bg-card">
                  <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-4 text-sm font-medium hover:bg-muted/30 transition-colors">
                    {faq.question}
                    <span className="ml-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180">
                      ▾
                    </span>
                  </summary>
                  <div className="border-t px-5 py-4 text-sm text-muted-foreground whitespace-pre-wrap">
                    {faq.answer}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* Footer note */}
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Prefer to speak to someone? Contact us at{" "}
          <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
            {contactEmail}
          </a>{" "}
          or visit the club.
        </p>
      </div>
    </main>
  );
}
