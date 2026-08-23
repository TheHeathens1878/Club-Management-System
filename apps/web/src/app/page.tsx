import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ShieldCheck, Users, Clock, LogIn, Package } from "lucide-react";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookClient } from "./book/book-client";
import { addDays, instantsToLocalWindow, localToInstant, londonToday } from "@/lib/booking-time";
import { FUNCTION_ROOM } from "@/lib/booking-types";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Availability is shown three London months ahead; the period is
  // timestamptz, so the cut-off is midnight London the day after the last one.
  const threeMonthsOut = (() => { const d = new Date(); d.setMonth(d.getMonth() + 3); return londonToday(d); })();

  const [s, rooms, rawBookings] = await Promise.all([
    getSettings(),
    createAdminClient()
      .from("resources")
      .select("id,name,description,capacity,price_pence_per_hour,price_pence_half_day,price_pence_full_day,amenities")
      .eq("type", FUNCTION_ROOM)
      .eq("active", true)
      .order("sort_order")
      .then((r) => r.data ?? []),
    createAdminClient()
      .from("bookings")
      .select("resource_id,starts_at,ends_at")
      .in("status", ["pending", "confirmed"])
      .lt("starts_at", localToInstant(addDays(threeMonthsOut, 1), "00:00"))
      .then((r) => r.data ?? []),
  ]);

  const logoHeight = Number(s.logo_height) || 80;
  const logoMaxWidth = Number(s.logo_max_width) || 300;
  const objectFit = (s.logo_object_fit ?? "contain") as "contain" | "cover" | "fill";

  const roomList = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    capacity: r.capacity,
    price_pence_per_hour: r.price_pence_per_hour,
    price_pence_half_day: r.price_pence_half_day,
    price_pence_full_day: r.price_pence_full_day,
    amenities: r.amenities,
  }));

  const bookedSlots = rawBookings.map((b) => {
    const window = instantsToLocalWindow(b.starts_at, b.ends_at);
    return {
      resource_id: b.resource_id,
      date: window.date,
      start_time: window.startTime,
      end_time: window.endTime,
    };
  });

  return (
    <main className="min-h-screen bg-gradient-to-b from-primary/8 via-background to-background">
      {/* Header bar */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {s.logo_url ? (
              <div style={{ height: Math.min(logoHeight, 48), maxWidth: Math.min(logoMaxWidth, 160) }} className="overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.logo_url} alt={s.logo_alt} style={{ width: "100%", height: "100%", objectFit }} />
              </div>
            ) : (
              <div className="inline-flex rounded-lg bg-primary/10 p-2 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
            )}
            <span className="text-sm font-semibold">{s.club_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <LogIn className="h-4 w-4" /> Staff login
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-10 space-y-10">
        {/* Hero */}
        <div className="text-center pt-4">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{s.club_tagline}</h1>
          <p className="mt-3 text-base text-muted-foreground max-w-xl mx-auto">{s.club_description}</p>
        </div>

        {/* Function room hire section */}
        <section>
          <div className="mb-6">
            <h2 className="text-2xl font-bold tracking-tight">Function Room Hire</h2>
            <p className="mt-1 text-muted-foreground">
              Our function rooms are available for private hire — parties, meetings, celebrations and more.
              Select a date to check availability and submit a booking request.
            </p>
          </div>

          {/* Room overview cards */}
          {roomList.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 mb-6">
              {roomList.map((room) => (
                <div key={room.id} className="rounded-xl border bg-card p-5 shadow-sm">
                  <h3 className="font-semibold">{room.name}</h3>
                  {room.description && <p className="mt-1 text-sm text-muted-foreground">{room.description}</p>}
                  <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
                    {room.capacity && (
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Up to {room.capacity} guests</span>
                    )}
                    {room.price_pence_per_hour && (
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> From £{(room.price_pence_per_hour / 100).toFixed(0)}/hr</span>
                    )}
                  </div>
                  {room.amenities.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {room.amenities.map((r) => (
                        <span key={r} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">
                          <Package className="h-3 w-3" />{r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Availability calendar */}
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h3 className="mb-1 text-lg font-semibold">Check availability &amp; request a booking</h3>
            <p className="mb-6 text-sm text-muted-foreground">
              Click a date to see options and fill in your details. We&apos;ll confirm your booking by email.
            </p>
            {roomList.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No rooms are currently available online. Please contact us directly.
              </p>
            ) : (
              <BookClient rooms={roomList} bookedSlots={bookedSlots} />
            )}
          </div>
        </section>

      </div>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        {s.club_name} ·{" "}
        <Link href="/contact" className="hover:underline">Contact</Link>
        {" · "}
        <Link href="/privacy" className="hover:underline">Privacy notice</Link>
      </footer>
    </main>
  );
}
