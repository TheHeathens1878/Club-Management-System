import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarPlus, Mail, Phone } from "lucide-react";

import { LinkRow } from "@/components/link-row";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile, isStaff } from "@/lib/auth";
import { formatBookingDate, formatBookingDateShort } from "@/lib/booking-time";
import {
  BOOKING_LIST_SELECT,
  FUNCTION_ROOM,
  bookingStatusVariant,
  toBookingListItem,
} from "@/lib/booking-types";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

/**
 * /room-bookings/contacts/[id] — one hire contact and everything the club has
 * done with them (Adam, 2026-09-12: the contacts book's rows open a contact
 * page). How to reach them at the top; every booking they have ever made
 * beneath, newest first, each row a link to the booking. Nothing is edited
 * here: a contact's details are refreshed by the booking flows, and a booking
 * is changed on its own page.
 *
 * Read as the caller — `booking_contacts` and `bookings` are staff/club_admin
 * under RLS, so an empty page is the database's answer, not a bug.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("booking_contacts").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Hire contact" };
}

export default async function BookingContactPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isStaff(session.profile?.role)) redirect("/lobby");

  const { id } = await params;
  const supabase = await createClient();
  const [{ data: contact }, { data: bookingRows }, { data: rooms }] = await Promise.all([
    supabase
      .from("booking_contacts")
      .select("id,name,first_name,last_name,email,phone,notes,created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("bookings")
      .select(BOOKING_LIST_SELECT)
      .eq("contact_id", id)
      .order("starts_at", { ascending: false }),
    supabase.from("resources").select("id,name").eq("type", FUNCTION_ROOM),
  ]);
  if (!contact) notFound();

  const roomName = new Map((rooms ?? []).map((room) => [room.id, room.name]));
  const bookings = (bookingRows ?? []).map(toBookingListItem);
  const hires = bookings.filter((booking) => booking.status !== "cancelled").length;
  const spent = bookings
    .filter((booking) => booking.payment_status === "paid")
    .reduce((sum, booking) => sum + (booking.total_pence ?? 0), 0);

  return (
    <>
      <PageHeader
        title={contact.name}
        subtitle={`${hires} ${hires === 1 ? "hire" : "hires"} · contact since ${formatBookingDateShort(contact.created_at.slice(0, 10))}`}
        back={{ href: "/room-bookings/contacts", label: "Hire contacts" }}
        action={
          <Link
            href="/room-bookings/new"
            className={buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] w-full lg:min-h-0 lg:w-auto"}
          >
            <CalendarPlus className="h-4 w-4" /> New booking
          </Link>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                {contact.email ? (
                  <a href={`mailto:${contact.email}`} className="break-all text-primary hover:underline">
                    {contact.email}
                  </a>
                ) : (
                  <span className="text-muted-foreground">No email</span>
                )}
              </p>
              <p className="flex items-center gap-2">
                <Phone className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                {contact.phone ? (
                  <a href={`tel:${contact.phone}`} className="hover:underline">
                    {contact.phone}
                  </a>
                ) : (
                  <span className="text-muted-foreground">No phone</span>
                )}
              </p>
              {contact.notes ? (
                <p className="whitespace-pre-line pt-1 text-muted-foreground">{contact.notes}</p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Paid to the club</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-3xl font-semibold uppercase tracking-wide">{formatCurrency(spent)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Across every paid booking on this contact.</p>
            </CardContent>
          </Card>
        </div>

        {bookings.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No bookings on this contact yet.
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Phone: one card per booking, the whole card a link. */}
            <div className="space-y-2 lg:hidden">
              {bookings.map((booking) => (
                <Link
                  key={booking.id}
                  href={`/room-bookings/${booking.id}`}
                  className="block rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-secondary/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-medium">{formatBookingDate(booking.date)}</p>
                    <Badge variant={bookingStatusVariant(booking.status)} className="capitalize">
                      {booking.kind === "block" ? "Blocked" : booking.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {booking.start_time}–{booking.end_time} · {roomName.get(booking.resource_id) ?? "Room"}
                    {booking.occasion ? ` · ${booking.occasion}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {booking.total_pence != null ? formatCurrency(booking.total_pence) : "No price yet"}
                    {booking.payment_status === "paid" ? " · paid" : ""}
                  </p>
                </Link>
              ))}
            </div>

            <div className="hidden overflow-x-auto rounded-xl border bg-card shadow-sm lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Time</th>
                    <th className="px-4 py-2.5 font-medium">Room</th>
                    <th className="px-4 py-2.5 font-medium">Occasion</th>
                    <th className="px-4 py-2.5 font-medium">Guests</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bookings.map((booking) => (
                    <LinkRow
                      key={booking.id}
                      href={`/room-bookings/${booking.id}`}
                      className="transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-4 py-3 align-top font-medium">{formatBookingDate(booking.date)}</td>
                      <td className="px-4 py-3 align-top">
                        {booking.start_time}–{booking.end_time}
                      </td>
                      <td className="px-4 py-3 align-top">{roomName.get(booking.resource_id) ?? "—"}</td>
                      <td className="px-4 py-3 align-top">
                        {booking.occasion ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {booking.estimated_guests ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={bookingStatusVariant(booking.status)} className="capitalize">
                            {booking.kind === "block" ? "Blocked" : booking.status}
                          </Badge>
                          {booking.payment_status === "paid" ? (
                            <Badge variant="success" className="text-[10px]">
                              Paid
                            </Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right align-top">
                        {booking.total_pence != null ? (
                          formatCurrency(booking.total_pence)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </LinkRow>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
