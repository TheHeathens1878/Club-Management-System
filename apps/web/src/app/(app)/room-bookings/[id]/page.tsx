import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { getSessionProfile, isStaff, isCommittee, isSuperUser } from "@/lib/auth";
import { bookingMoney, bookingNeedsTerms, bookingNextAction } from "@/lib/booking-next-action";
import { formatBookingDate, instantsToLocalWindow } from "@/lib/booking-time";
import { FUNCTION_ROOM } from "@/lib/booking-types";
import { bookingDepositPence, depositRuleFrom, depositRuleLabel, sumSecurityPaid } from "@/lib/hire-terms";
import { splitContactName } from "@/lib/person-name";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

import { addInternalNote } from "../actions";
import { BookingRecord, type BookingClashLine, type BookingEmailLine } from "./record";

export const metadata = { title: "Booking" };

/**
 * `/room-bookings/[id]` — one hire (P8.1).
 *
 * The page reads; `record.tsx` draws. Everything below is the reads this page
 * has always made, unchanged: the booking through the admin client (the desk
 * sees every booking, whoever made it), the two email logs merged into one,
 * and the `booking_conflicts()` RPC that says whether somebody else has this
 * night. The only new call is `bookingNextAction()`, which is pure.
 */
export default async function RoomBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isStaff(session.profile?.role)) redirect("/lobby");

  const { id } = await params;
  const admin = createAdminClient();

  const [
    { data: booking },
    { data: rooms },
    { data: paymentRows },
    { data: legacyComms },
    { data: outbound },
  ] = await Promise.all([
    admin.from("bookings").select("*").eq("id", id).maybeSingle(),
    admin.from("resources").select("id,name").eq("type", FUNCTION_ROOM).order("sort_order"),
    admin.from("payments").select("*").eq("booking_id", id).order("paid_at", { ascending: false }),
    // Every email about this booking, old app and new: the migrated
    // booking_comms history plus outbound_messages rows stamped with this
    // entity (reminders, quotes, confirmations, thank-yous).
    admin
      .from("booking_comms")
      .select("id,kind,to_address,subject,sent_at,sent_by_name")
      .eq("booking_id", id)
      .order("sent_at", { ascending: false }),
    admin
      .from("outbound_messages")
      .select("id,to_address,subject,template,status,sent_at,created_at")
      .eq("entity", "bookings")
      .eq("entity_id", id)
      .eq("channel", "email")
      .order("created_at", { ascending: false }),
  ]);

  const emailLog: BookingEmailLine[] = [
    ...(outbound ?? []).map((m) => ({
      id: `o-${m.id}`,
      at: m.sent_at ?? m.created_at,
      to: m.to_address ?? "—",
      subject: m.subject ?? m.template ?? "Email",
      via: m.status === "sent" ? "sent" : m.status,
    })),
    ...(legacyComms ?? []).map((m) => ({
      id: `l-${m.id}`,
      at: m.sent_at,
      to: m.to_address ?? "—",
      subject: m.subject ?? m.kind,
      via: m.sent_by_name ? `by ${m.sent_by_name}` : "sent",
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  if (!booking) notFound();

  // The period is timestamptz; this page has always shown London wall clock.
  const when = instantsToLocalWindow(booking.starts_at, booking.ends_at);

  // Does a row that is NOT holding the room sit on top of one that is? An
  // enquiry or a quote about a taken night is allowed (asking is free), but
  // the desk must see the clash before it reaches for Confirm — the constraint
  // would refuse that click, and the refusal is a worse way to find out.
  // A cancelled row is checked too: it can be re-quoted from this page, and
  // the desk should know first if the night has gone to somebody else.
  const holdsRoom = booking.status === "confirmed" || booking.status === "pending";
  const { data: clashRows } = await admin.rpc("booking_conflicts", {
    p_resource_id: booking.resource_id,
    p_starts_at: booking.starts_at,
    p_ends_at: booking.ends_at,
    p_exclude_booking_id: id,
  });
  const clashes: BookingClashLine[] = (clashRows ?? []).map((row) => {
    const w = instantsToLocalWindow(row.starts_at, row.ends_at);
    return {
      id: row.id,
      who: row.kind === "block" ? "Blocked by the club" : row.booker_name,
      status: row.status,
      when: `${w.startTime}–${w.endTime}`,
    };
  });

  const payments = (paymentRows ?? []).map((p) => ({
    id: p.id,
    amount_pence: p.amount_pence,
    paid_at: p.paid_at,
    method: p.method,
    reference: p.reference,
    refunded_pence: p.refunded_pence,
    source: p.source,
    authorised_by_name: p.authorised_by_name,
    note: p.note,
    purpose: p.purpose,
  }));

  const settings = await getSettings();
  const memberDiscountDefault = Number(settings.room_member_discount_pence) || 0;
  // The deposit rule (Adam, 2026-09-15): half the total cost, capped — worked
  // out for this booking, and offered to the desk as the prefill.
  const depositRule = depositRuleFrom(settings);
  const securityPaidPence = sumSecurityPaid(paymentRows ?? []);

  // The one thing this hire needs next, in the desk's voice. The same call in
  // the booker's voice is what `/portal` shows the hirer (P8.9), so the two
  // sides of the counter cannot disagree about where a booking stands.
  const nextActionInput = { booking, payments, clashes };
  const money = bookingMoney(nextActionInput);
  const nextAction = bookingNextAction(nextActionInput, { voice: "desk", now: new Date() });

  const roomName = (rooms ?? []).find((r) => r.id === booking.resource_id)?.name ?? "Unknown room";
  const canEdit = isStaff(session.profile?.role);
  const canDelete = isCommittee(session.profile?.role);
  const canEditBooking = isSuperUser(session.profile?.role);
  const shortRef = id.slice(0, 8).toUpperCase();

  async function saveNote(formData: FormData) {
    "use server";
    await addInternalNote(id, String(formData.get("internal_notes") || "").trim());
  }

  return (
    <>
      <PageHeader
        title={`Booking #${shortRef}`}
        subtitle={`${roomName} · ${formatBookingDate(when.date)}`}
        back={{ href: "/room-bookings", label: "Room bookings" }}
      />

      <BookingRecord
        bookingId={id}
        shortRef={shortRef}
        roomName={roomName}
        when={when}
        booking={booking}
        money={money}
        nextAction={nextAction}
        clashes={clashes}
        holdsRoom={holdsRoom}
        payments={payments}
        securityPaidPence={securityPaidPence}
        emailLog={emailLog}
        rooms={rooms ?? []}
        editInitial={{
          resource_id: booking.resource_id,
          date: when.date,
          start_time: when.startTime,
          end_time: when.endTime,
          booker_first_name: booking.booker_first_name ?? splitContactName(booking.booker_name).firstName,
          booker_last_name: booking.booker_last_name ?? splitContactName(booking.booker_name).lastName,
          booker_email: booking.booker_email,
          booker_phone: booking.booker_phone ?? "",
          occasion: booking.occasion ?? "",
          estimated_guests: booking.estimated_guests === null ? "" : String(booking.estimated_guests),
          notes: booking.notes ?? "",
        }}
        terms={{
          defaultDepositPence: bookingDepositPence(booking, depositRule),
          defaultSecurityDepositPence: Number(settings.security_deposit_default_pence) || 0,
          defaultMemberDiscountPence: booking.is_member ? memberDiscountDefault : null,
          depositRuleLabel: depositRuleLabel(depositRule),
          depositRule,
          needsTerms: bookingNeedsTerms(booking),
        }}
        canEdit={canEdit}
        canDelete={canDelete}
        canEditBooking={canEditBooking}
        saveNote={saveNote}
      />
    </>
  );
}
