import Link from "next/link";
import { Clock, HelpCircle, Info, LayoutGrid, Users } from "lucide-react";

import { FoldCard } from "@/components/ui/fold-card";
import { getSessionProfile } from "@/lib/auth";
import { parseExtrasConfig } from "@/lib/booking-extras";
import { instantsToLocalWindow, localToInstant, londonToday } from "@/lib/booking-time";
import { FUNCTION_ROOM } from "@/lib/booking-types";
import { standardHireSentence } from "@/lib/room-pricing";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";

import { BookFlow } from "./book-calendar";

export const metadata = { title: "Function room hire" };

export const dynamic = "force-dynamic";

/**
 * `/book` — the club's shop window (P8.9). A visitor arrives from a search or
 * a Facebook post on a phone, wanting to know one thing: is my date free, and
 * what would it cost?
 *
 * So the calendar IS the page. A slim band above it carries the club and, for
 * anybody already signed in, the way to their own bookings; the running
 * answer and the one button that sends it are pinned under that; the rooms
 * and their prices, and the FAQs, fold beneath — they are what you read once,
 * not what you came for.
 *
 * This route is outside `(app)`: no shell, no nav, no `role-view`. Its header
 * is local for that reason.
 */
export default async function BookPage() {
  const admin = createAdminClient();
  const settings = await getSettings();
  // Only to decide whether to offer "Your bookings": a visitor who is not
  // signed in is the normal case here and sees the page exactly as before.
  const session = await getSessionProfile();

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

  // Every future slot that is held, however far ahead. This used to stop three
  // months out while the calendar let a visitor page as far ahead as they
  // liked, so a wedding confirmed for next July showed as a free date and an
  // enquiry landed on top of it (Adam, 2026-09-11: "it should show the room
  // as busy in public view if it is confirmed"). Function rooms only —
  // `bookings` also holds every pitch booking. The period is timestamptz, so
  // "from today" is midnight London at the start of today.
  const { data: rawBookings } = await admin
    .from("bookings")
    .select("resource_id, starts_at, ends_at")
    .in(
      "resource_id",
      (rooms ?? []).map((room) => room.id),
    )
    .in("status", ["pending", "confirmed"])
    .gte("ends_at", localToInstant(londonToday(), "00:00"))
    .order("starts_at");

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
  const priceSummary =
    roomList
      .map((room) => standardHireSentence(room) || (room.price_pence_fixed ? formatCurrency(room.price_pence_fixed) : null))
      .filter(Boolean)
      .join(" · ") || "Ask us for a price";

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-40 h-14 border-b bg-card">
        <div className="mx-auto flex h-full max-w-3xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            {settings.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.logo_url}
                alt={settings.logo_alt || "Club logo"}
                style={{ height: 32, maxWidth: 120, objectFit: "contain" }}
              />
            ) : null}
            <span className="truncate text-row font-semibold">Function room hire</span>
          </div>
          {session ? (
            <Link
              href="/portal"
              className="touch -mr-2 inline-flex flex-none items-center rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Your bookings
            </Link>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4 lg:py-6">
        <p className="text-sm text-muted-foreground">
          {settings.club_description ||
            "Our function rooms are available to hire for private events, parties, meetings and celebrations."}
        </p>

        {roomList.length === 0 ? (
          <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            No rooms are currently available. Please contact us directly.
          </p>
        ) : (
          <BookFlow
            rooms={roomList}
            bookedSlots={bookedSlots}
            teamNames={(teamRows ?? []).map((t) => t.name)}
            memberDiscountPence={Number(settings.room_member_discount_pence) || 0}
          />
        )}

        <div className="space-y-2 pt-2">
          <FoldCard
            icon={<LayoutGrid className="h-4 w-4" aria-hidden />}
            title="Rooms and prices"
            summary={priceSummary}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {roomList.map((room) => (
                <div key={room.id} className="rounded-lg border bg-card p-4">
                  <h2 className="text-row font-semibold">{room.name}</h2>
                  {room.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{room.description}</p>
                  ) : null}
                  {room.capacity ? (
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users className="h-4 w-4 flex-none" aria-hidden />
                      Up to {room.capacity} guests
                    </p>
                  ) : null}
                  {standardHireSentence(room) ||
                  room.price_pence_fixed ||
                  room.price_pence_per_hour ||
                  room.price_pence_half_day ||
                  room.price_pence_full_day ? (
                    <div className="mt-3 space-y-1 border-t pt-3 text-sm">
                      {standardHireSentence(room) ? (
                        <p className="flex items-start gap-1.5 font-medium">
                          <Clock className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />
                          {standardHireSentence(room)}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-x-6 gap-y-1">
                        {!standardHireSentence(room) && room.price_pence_fixed ? (
                          <span className="font-medium">{formatCurrency(room.price_pence_fixed)}</span>
                        ) : null}
                        {room.price_pence_per_hour ? (
                          <span>{formatCurrency(room.price_pence_per_hour)}/hour</span>
                        ) : null}
                        {room.price_pence_half_day ? (
                          <span>{formatCurrency(room.price_pence_half_day)} half day</span>
                        ) : null}
                        {room.price_pence_full_day ? (
                          <span>{formatCurrency(room.price_pence_full_day)} full day</span>
                        ) : null}
                      </div>
                      {room.price_note ? (
                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
                          {room.price_note}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </FoldCard>

          {faqs.length > 0 ? (
            <FoldCard
              icon={<HelpCircle className="h-4 w-4" aria-hidden />}
              title="Frequently asked questions"
              summary={faqs
                .slice(0, 3)
                .map((faq) => faq.question)
                .join(" · ")}
            >
              <div className="space-y-2">
                {faqs.map((faq) => (
                  <details key={faq.id} className="group rounded-lg border bg-card">
                    <summary className="touch flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/30">
                      {faq.question}
                      <span className="flex-none text-muted-foreground transition-transform group-open:rotate-180" aria-hidden>
                        ▾
                      </span>
                    </summary>
                    <div className="whitespace-pre-wrap border-t px-4 py-3 text-sm text-muted-foreground">
                      {faq.answer}
                    </div>
                  </details>
                ))}
              </div>
            </FoldCard>
          ) : null}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Prefer to speak to someone? Contact us at{" "}
          <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
            {contactEmail}
          </a>{" "}
          or visit the club.
        </p>
      </main>
    </div>
  );
}
