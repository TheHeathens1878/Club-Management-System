/**
 * Confirming a room booking — one act, two doors (2026-09-13).
 *
 * The desk presses Confirm; the booker presses "Accept this quote" in their
 * portal (Leanne Minto, 2026-09-13, signed in five times to confirm a booking
 * and found nothing to press). Both land here.
 */

import { writeAudit } from "@/lib/audit";
import { conflictOrMessage } from "@/lib/booking-conflict";
import { addDays, formatBookingDate, instantsToLocalWindow, londonToday } from "@/lib/booking-time";
import { createCalendarEvent } from "@/lib/calendar";
import { sendEmail } from "@/lib/email";
import { bookingDepositPence, depositRuleFrom, memberInfoText, paymentTermsText, sumHirePaid } from "@/lib/hire-terms";
import { getEmailBrandColor, getSettings } from "@/lib/settings";
import type { createAdminClient } from "@/lib/supabase/admin";
import { renderEmailTemplate } from "@/lib/template-engine";
import { formatCurrency, getSiteUrl } from "@/lib/utils";

type AdminClient = ReturnType<typeof createAdminClient>;

export type ConfirmRoomBookingOpts = {
  totalPence?: number | null;
  depositPence?: number | null;
  memberDiscountPence?: number | null;
  /** The refundable security deposit held for the event; null = keep what the booking carries. */
  securityDepositPence?: number | null;
  /**
   * The desk has checked the booker's claimed membership (Adam, 2026-09-15:
   * a member discount goes on "with a date and person stamped confirmation
   * they've checked it"). Required for any discount above zero; stamped on
   * the booking with who and when.
   */
  memberChecked?: boolean;
};

export type ConfirmActor = {
  id: string | null;
  email: string;
  /** True when the booker accepted the quote in their portal (20260913190000). */
  byBooker?: boolean;
};

/**
 * Confirm a room booking: the price, the deposit and its deadline, the
 * balance's, the calendar event, the audit row and the confirmation email
 * with the terms. Called by the desk's Confirm (room-bookings/actions) and by
 * the booker accepting a quote (portal/actions) — the same act, so the same
 * code, and this module is not a server action file on purpose: only those
 * two, each with its own guard, can reach it.
 */
export async function confirmRoomBooking(
  admin: AdminClient,
  bookingId: string,
  opts: ConfirmRoomBookingOpts,
  actor: ConfirmActor,
): Promise<{ error?: string }> {

  const { data: booking, error: fetchErr } = await admin
    .from("bookings")
    .select(
      "booker_name,booker_email,starts_at,ends_at,occasion,estimated_guests,total_pence,base_hire_pence,security_deposit_pence,payment_status,is_member,membership_type,member_number,member_discount_pence,resources(name)",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (fetchErr || !booking) return { error: "Booking not found." };

  const window = instantsToLocalWindow(booking.starts_at, booking.ends_at);

  const settings = await getSettings();
  const depositWindow = Number(settings.deposit_window_days) || 7;
  const balanceDays = Number(settings.balance_reminder_days) || 14;

  // A blank price box keeps the price the booking already carries — a quote,
  // or an earlier confirmation. Writing NULL over it meant the booking could
  // never reach "paid" and no balance reminder would ever go.
  const totalPence = opts?.totalPence ?? booking.total_pence ?? null;
  // The deposit rule (Adam, 2026-09-15): half the total cost, capped at £100,
  // non-refundable. The desk may type another figure for this booking.
  const defaultDeposit = bookingDepositPence(
    { base_hire_pence: booking.base_hire_pence, total_pence: totalPence },
    depositRuleFrom(settings),
  );
  const depositPence = opts?.depositPence ?? defaultDeposit;
  // The refundable security deposit: what the desk typed; else what the
  // booking carries (an 18th's £200 from the public form); else the club's
  // default (Adam, 2026-09-15: £100) — so a booker accepting a quote gets the
  // same terms the desk would have set.
  const securityDefault = Number(settings.security_deposit_default_pence) || 0;
  const securityDepositPence = Math.max(
    0,
    opts?.securityDepositPence ?? (Number(booking.security_deposit_pence ?? 0) > 0 ? Number(booking.security_deposit_pence) : securityDefault),
  );

  // A member discount needs the membership checked first, and the check is
  // stamped with who and when. Only the desk can tick; a booker accepting a
  // quote sends no discount and no tick.
  const discountPence = opts?.memberDiscountPence ?? null;
  if (discountPence != null && discountPence > 0 && !opts?.memberChecked) {
    return { error: "Tick to confirm you have checked their membership before applying a member discount." };
  }
  const memberCheckStamp = opts?.memberChecked
    ? {
        member_checked_at: new Date().toISOString(),
        member_checked_by: actor.id,
        member_checked_by_email: actor.email,
      }
    : {};

  // Deposit due = today + window; balance due = booking date − reminder lead
  // time. "Today" is the London date: the server runs in UTC, and between
  // midnight and 1am BST the UTC date is still yesterday, which used to hand
  // out a deadline a day early.
  const depositDueStr = addDays(londonToday(), depositWindow);
  const depositDue = new Date(`${depositDueStr}T12:00:00Z`);

  const balanceDueStr = addDays(window.date, -balanceDays);

  // Create calendar event before status update so we can store the event ID
  const roomName = booking.resources?.name ?? "Function Room";
  const calEventId = await createCalendarEvent({
    date: window.date,
    start_time: window.startTime,
    end_time: window.endTime,
    room_name: roomName,
    booker_name: booking.booker_name,
    occasion: booking.occasion,
    estimated_guests: booking.estimated_guests,
  }).catch(() => null);

  const { error } = await admin
    .from("bookings")
    .update({
      status: "confirmed",
      ...(actor.byBooker ? { quote_accepted_at: new Date().toISOString() } : {}),
      total_pence: totalPence,
      deposit_pence: depositPence,
      security_deposit_pence: securityDepositPence,
      // The club-family discount, once the desk has checked the claimed
      // child against the members list (Adam, 2026-09-03: "the child and
      // child's team was for member discount"). Informational beside the
      // total the staff typed, which is already the discounted price.
      ...(discountPence != null ? { member_discount_pence: discountPence } : {}),
      ...memberCheckStamp,
      deposit_due_date: depositDueStr,
      balance_due_date: balanceDueStr,
      ...(calEventId ? { calendar_event_id: calEventId } : {}),
    })
    .eq("id", bookingId);

  // Promoting an enquiry/quote to `confirmed` brings it under
  // `bookings_no_overlap` for the first time, so this update can collide.
  if (error) return { error: conflictOrMessage(error, "Failed to confirm booking.") };

  await writeAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "confirm",
    entity: "room_booking",
    entityId: bookingId,
    detail: {
      total_pence: totalPence,
      deposit_pence: depositPence,
      security_deposit_pence: securityDepositPence,
      ...(discountPence != null ? { member_discount_pence: discountPence, member_checked: opts?.memberChecked === true } : {}),
      by_booker: actor.byBooker === true,
    },
  });

  // Send confirmation email to booker
  if (booking.booker_email && booking.booker_email !== "—") {
    (async () => {
      try {
        const brandColor = await getEmailBrandColor().catch(() => "#1249bf");
        const dateFormatted = formatBookingDate(window.date);
        const depositDueFormatted = depositDue.toLocaleDateString("en-GB", {
          day: "numeric", month: "long", year: "numeric",
        });

        // The terms as they apply to THIS booking: the deposit that secures
        // the room (non-refundable, paid first), then the balance plus any
        // refundable security deposit two weeks before. A re-confirmation
        // after the deposit has been paid says so rather than asking again.
        const { data: paidRows } = await admin
          .from("payments")
          .select("amount_pence,refunded_pence,purpose")
          .eq("booking_id", bookingId);
        const hirePaid = sumHirePaid(paidRows ?? []);
        const balanceDueFormatted = new Date(`${balanceDueStr}T12:00:00Z`).toLocaleDateString("en-GB", {
          day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
        });
        let paymentStatusText = paymentTermsText({
          depositPence,
          depositDueLabel: depositDueFormatted,
          depositPaid: depositPence > 0 && hirePaid >= depositPence,
          // What is left once the deposit is in: the total less the larger of
          // what has been paid and the deposit itself.
          balancePence: Math.max(0, (totalPence ?? 0) - Math.max(hirePaid, depositPence)),
          balanceDueLabel: balanceDueFormatted,
          securityDepositPence,
        });
        if (!paymentStatusText) {
          paymentStatusText = totalPence
            ? `The total cost is ${formatCurrency(totalPence)}. Please pay via your booking portal.`
            : "No payment is required at this stage.";
        }

        const tpl = await renderEmailTemplate("room_booking_confirmed", {
          name: booking.booker_name,
          room_name: roomName,
          booking_date: dateFormatted,
          start_time: window.startTime,
          end_time: window.endTime,
          occasion: booking.occasion ?? "Private hire",
          payment_status: paymentStatusText,
          total_cost: totalPence ? formatCurrency(totalPence) : "—",
          deposit_amount: depositPence > 0 ? formatCurrency(depositPence) : "—",
          deposit_due_date: depositPence > 0 ? depositDueFormatted : "—",
          balance_due_date: balanceDueFormatted,
          security_deposit: securityDepositPence > 0 ? formatCurrency(securityDepositPence) : "—",
          // The club's customised template (2026-08-20) carries {{member_info}}
          // from the old room app; nothing here filled it, so the hirer read
          // the placeholder itself (Adam, 2026-09-15). Blank for a non-member.
          member_info: memberInfoText({
            is_member: booking.is_member,
            membership_type: booking.membership_type,
            member_number: booking.member_number,
            member_discount_pence: opts?.memberDiscountPence ?? booking.member_discount_pence,
          }),
          portal_url: `${getSiteUrl()}/portal`,
        }, brandColor);

        await sendEmail({ to: booking.booker_email, ...tpl });
      } catch (e) {
        console.error("[room-booking] Confirmation email failed:", e);
      }
    })();
  }

  return {};
}
