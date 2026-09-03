"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile, isCommittee, isStaff, isSuperUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { upsertBookingContact } from "@/lib/booking-contacts";
import { joinContactName } from "@/lib/person-name";
import { sendEmail } from "@/lib/email";
import { renderEmailTemplate } from "@/lib/template-engine";
import { getEmailBrandColor, getSettings, getRecipientEmails } from "@/lib/settings";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/calendar";
import { formatCurrency, getSiteUrl } from "@/lib/utils";
import {
  addDays,
  formatBookingDate,
  instantToLocal,
  instantsToLocalWindow,
  isValidDateString,
  isValidTimeString,
  legacyWindowToInstants,
} from "@/lib/booking-time";
import {
  bookingPeriod,
  FUNCTION_ROOM,
  type BookingInsert,
  type BookingPaymentStatus,
  type BookingStatus,
} from "@/lib/booking-types";
import {
  conflictOrMessage,
  slotHasConflict,
  SLOT_TAKEN_MESSAGE,
} from "@/lib/booking-conflict";

type AdminClient = ReturnType<typeof createAdminClient>;

async function requireStaff() {
  const session = await getSessionProfile();
  if (!session || !isStaff(session.profile?.role)) redirect("/lobby");
  return session;
}

async function requireCommittee() {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) redirect("/lobby");
  return session;
}

export async function confirmBooking(
  bookingId: string,
  opts?: { totalPence?: number | null; depositPence?: number | null },
): Promise<{ error?: string }> {
  const session = await requireStaff();
  const admin = createAdminClient();

  const { data: booking, error: fetchErr } = await admin
    .from("bookings")
    .select(
      "booker_name,booker_email,starts_at,ends_at,occasion,estimated_guests,total_pence,payment_status,resources(name)",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (fetchErr || !booking) return { error: "Booking not found." };

  const window = instantsToLocalWindow(booking.starts_at, booking.ends_at);

  const settings = await getSettings();
  const depositWindow = Number(settings.deposit_window_days) || 7;
  const balanceDays = Number(settings.balance_reminder_days) || 14;
  const defaultDeposit = Number(settings.deposit_default_pence) || 0;

  const totalPence = opts?.totalPence ?? null;
  const depositPence = opts?.depositPence ?? defaultDeposit;

  // Deposit due = today + window; balance due = booking date − reminder lead time
  const depositDue = new Date();
  depositDue.setDate(depositDue.getDate() + depositWindow);
  const depositDueStr = depositDue.toISOString().slice(0, 10);

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
      total_pence: totalPence,
      deposit_pence: depositPence,
      deposit_due_date: depositDueStr,
      balance_due_date: balanceDueStr,
      ...(calEventId ? { calendar_event_id: calEventId } : {}),
    })
    .eq("id", bookingId);

  // Promoting an enquiry/quote to `confirmed` brings it under
  // `bookings_no_overlap` for the first time, so this update can collide.
  if (error) return { error: conflictOrMessage(error, "Failed to confirm booking.") };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "confirm",
    entity: "room_booking",
    entityId: bookingId,
    detail: { total_pence: totalPence, deposit_pence: depositPence },
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

        let paymentStatusText: string;
        if (depositPence > 0) {
          paymentStatusText = `This confirmation is subject to a deposit of ${formatCurrency(depositPence)} being paid by ${depositDueFormatted}.`
            + (totalPence ? ` The total cost is ${formatCurrency(totalPence)}.` : "");
        } else if (totalPence) {
          paymentStatusText = `The total cost is ${formatCurrency(totalPence)}. Please pay via your booking portal.`;
        } else {
          paymentStatusText = "No payment is required at this stage.";
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

export async function cancelBooking(
  bookingId: string,
  reason: string
): Promise<{ error?: string }> {
  const session = await requireStaff();
  if (!reason.trim()) return { error: "A cancellation reason is required." };

  const admin = createAdminClient();

  const { data: booking, error: fetchErr } = await admin
    .from("bookings")
    .select("booker_name,booker_email,starts_at,ends_at,calendar_event_id,resources(name)")
    .eq("id", bookingId)
    .maybeSingle();

  if (fetchErr || !booking) return { error: "Booking not found." };

  const window = instantsToLocalWindow(booking.starts_at, booking.ends_at);

  const { error } = await admin
    .from("bookings")
    .update({ status: "cancelled", internal_notes: `Cancellation reason: ${reason.trim()}` })
    .eq("id", bookingId);

  if (error) return { error: "Failed to cancel booking." };

  // Remove the calendar event if one was created
  const calEventId = booking.calendar_event_id;
  if (calEventId) deleteCalendarEvent(calEventId).catch(() => {});

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cancel",
    entity: "room_booking",
    entityId: bookingId,
    detail: { reason: reason.trim() },
  });

  if (booking.booker_email && booking.booker_email !== "—") {
    (async () => {
      try {
        const brandColor = await getEmailBrandColor().catch(() => "#1249bf");
        const cancelRoomName = booking.resources?.name ?? "Function Room";
        const tpl = await renderEmailTemplate("room_booking_cancelled", {
          name: booking.booker_name,
          room_name: cancelRoomName,
          booking_date: formatBookingDate(window.date),
          start_time: window.startTime,
          end_time: window.endTime,
          cancellation_reason: reason.trim(),
        }, brandColor);
        const cc = await getRecipientEmails("notify_cancellation").catch(() => []);
        await sendEmail({ to: booking.booker_email, cc, ...tpl });
      } catch (e) {
        console.error("[room-booking] Cancellation email failed:", e);
      }
    })();
  }

  return {};
}

export async function updateBookingStatus(
  bookingId: string,
  status: string
): Promise<{ error?: string }> {
  const session = await requireStaff();
  const admin = createAdminClient();

  const allowed: BookingStatus[] = ["pending", "confirmed", "cancelled"];
  if (!allowed.includes(status as BookingStatus)) {
    return { error: "Invalid status." };
  }
  const nextStatus = status as BookingStatus;

  const { error } = await admin
    .from("bookings")
    .update({ status: nextStatus })
    .eq("id", bookingId);

  // Moving into `pending`/`confirmed` brings the row under
  // `bookings_no_overlap`, so this update can collide with a live booking.
  if (error) return { error: conflictOrMessage(error, "Failed to update status.") };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `status_${status}`,
    entity: "room_booking",
    entityId: bookingId,
  });

  return {};
}

export async function addInternalNote(
  bookingId: string,
  note: string
): Promise<{ error?: string }> {
  const session = await requireStaff();
  const admin = createAdminClient();

  const { error } = await admin
    .from("bookings")
    .update({ internal_notes: note.trim() || null })
    .eq("id", bookingId);

  if (error) return { error: "Failed to save note." };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "add_note",
    entity: "room_booking",
    entityId: bookingId,
  });

  revalidatePath(`/room-bookings/${bookingId}`);
  return {};
}

export async function updateBooking(
  bookingId: string,
  fields: {
    resource_id: string;
    date: string;
    start_time: string;
    end_time: string;
    booker_first_name: string;
    booker_last_name: string;
    booker_name: string;
    booker_email: string;
    booker_phone: string | null;
    occasion: string | null;
    estimated_guests: number | null;
    notes: string | null;
  }
): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session || !isSuperUser(session.profile?.role)) return { error: "Not authorised." };

  if (!isValidDateString(fields.date)) return { error: "Please enter a valid date." };
  if (!isValidTimeString(fields.start_time) || !isValidTimeString(fields.end_time)) {
    return { error: "Please enter valid start and end times." };
  }

  const admin = createAdminClient();
  const { startsAt, endsAt } = legacyWindowToInstants(
    fields.date,
    fields.start_time,
    fields.end_time,
  );

  if (
    await slotHasConflict(admin, {
      resourceId: fields.resource_id,
      startsAt,
      endsAt,
      excludeBookingId: bookingId,
    })
  ) {
    return { error: SLOT_TAKEN_MESSAGE };
  }

  // Keep the room's contacts book in step with the edited snapshot.
  const contactId = await upsertBookingContact({
    name: fields.booker_name,
    firstName: fields.booker_first_name,
    lastName: fields.booker_last_name,
    email: fields.booker_email,
    phone: fields.booker_phone,
  }).catch(() => null);

  const { error } = await admin
    .from("bookings")
    .update({
      resource_id: fields.resource_id,
      ...bookingPeriod(startsAt, endsAt),
      ...(contactId ? { contact_id: contactId } : {}),
      booker_first_name: fields.booker_first_name,
      booker_last_name: fields.booker_last_name,
      booker_name: fields.booker_name,
      booker_email: fields.booker_email,
      booker_phone: fields.booker_phone,
      occasion: fields.occasion,
      estimated_guests: fields.estimated_guests,
      notes: fields.notes,
    })
    .eq("id", bookingId);

  if (error) return { error: conflictOrMessage(error, "Failed to update booking.") };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entity: "room_booking",
    entityId: bookingId,
    detail: fields,
  });

  revalidatePath(`/room-bookings/${bookingId}`);
  revalidatePath("/room-bookings");
  return {};
}

// Recompute payment_status from the sum of payments vs total/deposit.
// Returns the new totals so callers can use them (e.g. for emails).
async function recomputePaymentStatus(
  admin: AdminClient,
  bookingId: string,
): Promise<{ totalPence: number; depositPence: number; paidPence: number }> {
  const [{ data: booking }, { data: payments }] = await Promise.all([
    admin.from("bookings").select("total_pence,deposit_pence").eq("id", bookingId).maybeSingle(),
    admin.from("payments").select("amount_pence").eq("booking_id", bookingId),
  ]);

  const totalPence = Number(booking?.total_pence ?? 0);
  const depositPence = Number(booking?.deposit_pence ?? 0);
  const paidPence = (payments ?? []).reduce((acc, p) => acc + Number(p.amount_pence ?? 0), 0);

  let status: BookingPaymentStatus;
  if (totalPence > 0 && paidPence >= totalPence) status = "paid";
  else if (depositPence > 0 && paidPence >= depositPence) status = "deposit_paid";
  else if (paidPence > 0) status = "deposit_paid";
  else status = "unpaid";

  await admin.from("bookings").update({ payment_status: status }).eq("id", bookingId);
  return { totalPence, depositPence, paidPence };
}

export async function addPayment(
  bookingId: string,
  input: {
    amount_pence: number;
    paid_at: string;        // ISO date or datetime
    method: string;
    reference: string | null;
    note: string | null;
    send_email: boolean;
  },
): Promise<{ error?: string }> {
  const session = await requireStaff();
  const admin = createAdminClient();

  if (!input.amount_pence || input.amount_pence <= 0) return { error: "Enter a valid amount." };

  const authorisedName = session.profile?.full_name || session.email || "Staff";

  const { error: insertErr } = await admin.from("payments").insert({
    booking_id: bookingId,
    amount_pence: input.amount_pence,
    paid_at: input.paid_at ? new Date(input.paid_at).toISOString() : new Date().toISOString(),
    method: input.method || null,
    reference: input.reference || null,
    source: "manual",
    authorised_by_profile: session.userId,
    authorised_by_name: authorisedName,
    authorised_by_email: session.email,
    note: input.note || null,
  });
  if (insertErr) return { error: "Failed to record payment." };

  const { totalPence, paidPence } = await recomputePaymentStatus(admin, bookingId);

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "record_payment",
    entity: "room_booking",
    entityId: bookingId,
    detail: { amount_pence: input.amount_pence, method: input.method, authorised_by: authorisedName },
  });

  // Email the booker confirming this payment
  if (input.send_email) {
    (async () => {
      try {
        const { data: booking } = await admin
          .from("bookings")
          .select("booker_name,booker_email,starts_at,resources(name)")
          .eq("id", bookingId)
          .maybeSingle();
        if (booking?.booker_email && booking.booker_email !== "—") {
          const brandColor = await getEmailBrandColor().catch(() => "#1249bf");
          const roomName = booking.resources?.name ?? "Function room";
          const outstanding = Math.max(0, totalPence - paidPence);
          const tpl = await renderEmailTemplate("payment_received", {
            name: booking.booker_name,
            room_name: roomName,
            booking_date: formatBookingDate(instantToLocal(booking.starts_at).date),
            amount_paid: formatCurrency(input.amount_pence),
            total_paid: formatCurrency(paidPence),
            outstanding: totalPence > 0 ? formatCurrency(outstanding) : "—",
            payment_method: (input.method || "—").replace("_", " "),
          }, brandColor);
          await sendEmail({ to: booking.booker_email, ...tpl });
        }
      } catch (e) {
        console.error("[room-booking] Payment email failed:", e);
      }
    })();
  }

  revalidatePath(`/room-bookings/${bookingId}`);
  revalidatePath("/room-bookings");
  return {};
}

export async function deletePayment(paymentId: string, bookingId: string): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) return { error: "Not authorised." };

  const admin = createAdminClient();
  // Only manual payments can be deleted; SumUp records are locked.
  const { data: payment } = await admin
    .from("payments")
    .select("source")
    .eq("id", paymentId)
    .maybeSingle();
  if (payment?.source === "sumup") return { error: "SumUp payments cannot be deleted." };

  const { error } = await admin.from("payments").delete().eq("id", paymentId);
  if (error) return { error: "Failed to delete payment." };

  await recomputePaymentStatus(admin, bookingId);

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "delete_payment",
    entity: "room_booking",
    entityId: bookingId,
    detail: { payment_id: paymentId },
  });

  revalidatePath(`/room-bookings/${bookingId}`);
  return {};
}

export async function updateRoom(formData: FormData): Promise<void> {
  await requireCommittee();
  const admin = createAdminClient();

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const capacity = formData.get("capacity") ? Number(formData.get("capacity")) : null;
  // Prices submitted in pounds; convert to pence
  const toP = (f: string) => { const v = formData.get(f); return v ? Math.round(Number(v) * 100) : null; };
  const pricePerHour = toP("price_pence_per_hour");
  const priceHalfDay = toP("price_pence_half_day");
  const priceFullDay = toP("price_pence_full_day");
  const priceFixed = toP("price_pence_fixed");
  const priceNote = String(formData.get("price_note") ?? "").trim() || null;
  const active = formData.get("active") === "true";
  // Was function_rooms.resources; `resources` is the table name now, so the
  // column is `amenities`.
  const amenities = String(formData.get("amenities") ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  if (!id) redirect(`/room-bookings/rooms?error=${encodeURIComponent("Room ID missing.")}`);
  if (!name) redirect(`/room-bookings/rooms?error=${encodeURIComponent("Room name is required.")}`);

  const { error } = await admin
    .from("resources")
    .update({
      name, description, capacity, active, amenities,
      price_pence_per_hour: pricePerHour,
      price_pence_half_day: priceHalfDay,
      price_pence_full_day: priceFullDay,
      price_pence_fixed: priceFixed,
      price_note: priceNote,
    })
    .eq("id", id)
    .eq("type", FUNCTION_ROOM);

  if (error) redirect(`/room-bookings/rooms?error=${encodeURIComponent("Failed to save: " + error.message)}`);

  revalidatePath("/room-bookings/rooms");
  redirect(`/room-bookings/rooms?saved=${id}`);
}

export async function createRoom(formData: FormData): Promise<void> {
  await requireCommittee();
  const admin = createAdminClient();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const capacity = formData.get("capacity") ? Number(formData.get("capacity")) : null;

  if (!name) redirect(`/room-bookings/rooms?error=${encodeURIComponent("Room name is required.")}`);

  const { data: last } = await admin
    .from("resources")
    .select("sort_order")
    .eq("type", FUNCTION_ROOM)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (last?.[0]?.sort_order ?? 0) + 10;

  const { error } = await admin.from("resources").insert({
    type: FUNCTION_ROOM, name, description, capacity, active: true, sort_order: nextSort,
  });
  if (error) redirect(`/room-bookings/rooms?error=${encodeURIComponent("Failed to create room: " + error.message)}`);

  revalidatePath("/room-bookings/rooms");
  redirect("/room-bookings/rooms?saved=new");
}

export async function deleteRoom(roomId: string): Promise<void> {
  await requireCommittee();
  const admin = createAdminClient();
  const { error } = await admin
    .from("resources")
    .delete()
    .eq("id", roomId)
    .eq("type", FUNCTION_ROOM);
  if (error) redirect(`/room-bookings/rooms?error=${encodeURIComponent("Failed to delete room: " + error.message)}`);
  revalidatePath("/room-bookings/rooms");
  redirect("/room-bookings/rooms");
}

export async function deleteBooking(bookingId: string): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) return { error: "Not authorised." };

  const admin = createAdminClient();
  const { error } = await admin.from("bookings").delete().eq("id", bookingId);
  if (error) return { error: "Failed to delete booking." };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "delete",
    entity: "room_booking",
    entityId: bookingId,
  });

  revalidatePath("/room-bookings");
  return {};
}

export async function deleteBookings(ids: string[]): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== "super_user") return { error: "Not authorised." };
  if (!ids.length) return {};

  const admin = createAdminClient();
  const { error } = await admin.from("bookings").delete().in("id", ids);
  if (error) return { error: "Failed to delete bookings." };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "bulk_delete",
    entity: "room_booking",
    entityId: "multiple",
    detail: { count: ids.length, ids },
  });

  revalidatePath("/room-bookings");
  return {};
}

// Returns the date of the nth occurrence of dayOfWeek in the given year/month.
// nth is 1-based (1 = first, 2 = second, etc.). If the nth occurrence falls outside
// the month (e.g. 5th Saturday), the 4th occurrence is returned instead.
function nthWeekdayOfMonth(year: number, month: number, dayOfWeek: number, nth: number): Date {
  // Find the first occurrence of dayOfWeek in this month
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = firstOfMonth.getUTCDay();
  const firstOccurrence = 1 + ((dayOfWeek - firstDow + 7) % 7);
  let day = firstOccurrence + (nth - 1) * 7;
  // Clamp to last occurrence in month if it overflows
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  while (day > daysInMonth) day -= 7;
  return new Date(Date.UTC(year, month - 1, day));
}

export async function deleteBookingsByGroup(groupId: string): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== "super_user") return { error: "Not authorised." };

  const admin = createAdminClient();
  const { error } = await admin.from("bookings").delete().eq("recurrence_group_id", groupId);
  if (error) return { error: "Failed to delete series." };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "delete_series",
    entity: "room_booking",
    entityId: groupId,
    detail: { recurrence_group_id: groupId },
  });

  revalidatePath("/room-bookings");
  return {};
}

function generateRecurringDates(
  startDate: string,
  freq: string,
  untilDate: string,
  count: number,
): string[] {
  const dates: string[] = [];
  let current = startDate;
  const maxCount = Math.min(count || 52, 104);

  // For monthly_weekday: derive the pattern once from the start date
  const startD = new Date(startDate + "T12:00:00Z");
  const startDayOfWeek = startD.getUTCDay();
  const startNth = Math.ceil(startD.getUTCDate() / 7);

  for (let i = 0; i < maxCount; i++) {
    const [y, m, d] = current.split("-").map(Number);
    if (y === undefined || m === undefined || d === undefined) break;
    let next: Date;
    if (freq === "weekly") {
      next = new Date(Date.UTC(y, m - 1, d + 7));
    } else if (freq === "fortnightly") {
      next = new Date(Date.UTC(y, m - 1, d + 14));
    } else if (freq === "monthly_weekday") {
      // Advance one month then find the nth weekday
      const nextMonth = m === 12 ? 1 : m + 1;
      const nextYear = m === 12 ? y + 1 : y;
      next = nthWeekdayOfMonth(nextYear, nextMonth, startDayOfWeek, startNth);
    } else {
      // monthly — same calendar day next month
      next = new Date(Date.UTC(y, m, d));
    }
    current = next.toISOString().slice(0, 10);
    if (untilDate && current > untilDate) break;
    dates.push(current);
  }

  return dates;
}

/**
 * Every date of a (possibly recurring) booking, checked against
 * `booking_has_conflict()` before anything is written.
 *
 * The whole series is checked up front rather than row by row: a single
 * multi-row insert is one statement, so one clashing occurrence would abort
 * the lot, and creating a partial series and then reporting a failure would be
 * worse than creating nothing.
 */
async function findConflictingDates(
  admin: AdminClient,
  resourceId: string,
  dates: string[],
  startTime: string,
  endTime: string,
): Promise<string[]> {
  const checked = await Promise.all(
    dates.map(async (date) => {
      const { startsAt, endsAt } = legacyWindowToInstants(date, startTime, endTime);
      return (await slotHasConflict(admin, { resourceId, startsAt, endsAt })) ? date : null;
    }),
  );
  return checked.filter((date): date is string => date !== null);
}

function conflictListMessage(dates: string[]): string {
  const shown = dates.slice(0, 3).map(formatBookingDate).join(", ");
  const rest = dates.length - Math.min(dates.length, 3);
  return dates.length === 1
    ? `${SLOT_TAKEN_MESSAGE} (${shown})`
    : `${SLOT_TAKEN_MESSAGE} Clashes on ${shown}${rest > 0 ? ` and ${rest} more` : ""}.`;
}

export async function createBlockBooking(
  formData: FormData
): Promise<{ error?: string }> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  const roomId = String(formData.get("room_id") || "").trim();
  const date = String(formData.get("date") || "").trim();
  const startTime = String(formData.get("start_time") || "").trim();
  const endTime = String(formData.get("end_time") || "").trim();
  const reason = String(formData.get("reason") || "").trim() || null;
  const recurring = formData.get("recurring") === "on";
  const recurrenceFreq = String(formData.get("recurrence_freq") || "weekly");
  const recurrenceUntil = String(formData.get("recurrence_until") || "").trim();
  const recurrenceCount = formData.get("recurrence_count") ? Number(formData.get("recurrence_count")) : 12;

  if (!roomId || !date || !startTime || !endTime)
    return { error: "Room, date, start time and end time are required." };
  if (!isValidDateString(date)) return { error: "Please enter a valid date." };
  if (!isValidTimeString(startTime) || !isValidTimeString(endTime))
    return { error: "Please enter valid start and end times." };

  const recurrenceGroupId = recurring ? crypto.randomUUID() : null;
  const extraDates = recurring
    ? generateRecurringDates(date, recurrenceFreq, recurrenceUntil, recurrenceCount)
    : [];

  const clashes = await findConflictingDates(admin, roomId, [date, ...extraDates], startTime, endTime);
  if (clashes.length > 0) return { error: conflictListMessage(clashes) };

  function rowFor(d: string): BookingInsert {
    const { startsAt, endsAt } = legacyWindowToInstants(d, startTime, endTime);
    return {
      resource_id: roomId,
      ...bookingPeriod(startsAt, endsAt),
      booker_name: "Club",
      booker_email: "—",
      occasion: reason,
      status: "confirmed",
      kind: "block",
      recurrence_group_id: recurrenceGroupId,
    };
  }

  const { data: booking, error } = await admin
    .from("bookings")
    .insert(rowFor(date))
    .select("id")
    .single();

  if (error || !booking) {
    return { error: conflictOrMessage(error, error?.message ?? "Failed to create block.") };
  }

  if (extraDates.length > 0) {
    const { error: extrasErr } = await admin
      .from("bookings")
      .insert(extraDates.map(rowFor));
    if (extrasErr) {
      return {
        error: conflictOrMessage(
          extrasErr,
          "The first block was created but the repeats could not be saved.",
        ),
      };
    }
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "create_block",
    entity: "room_booking",
    entityId: booking.id,
    detail: { date, resource_id: roomId, reason, recurring, recurrenceFreq, recurrenceGroupId },
  });

  revalidatePath("/room-bookings");
  return {};
}

export async function createInternalBooking(
  formData: FormData
): Promise<{ error?: string }> {
  const session = await requireStaff();
  const admin = createAdminClient();

  const roomId = String(formData.get("room_id") || "").trim();
  const date = String(formData.get("date") || "").trim();
  const startTime = String(formData.get("start_time") || "").trim();
  const endTime = String(formData.get("end_time") || "").trim();
  // Two boxes since 2026-08-26 ("for all contacts, first name and last name are
  // separate"). `booker_name` stays as the snapshot the emails and exports read,
  // composed from the two.
  const bookerFirstName = String(formData.get("booker_first_name") || "").trim();
  const bookerLastName = String(formData.get("booker_last_name") || "").trim();
  const bookerName = joinContactName(bookerFirstName, bookerLastName);
  const bookerEmail = String(formData.get("booker_email") || "").trim();
  const bookerPhone = String(formData.get("booker_phone") || "").trim() || null;
  const occasion = String(formData.get("occasion") || "").trim() || null;
  const estimatedGuests = formData.get("estimated_guests") ? Number(formData.get("estimated_guests")) : null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const statusInput = String(formData.get("status") || "confirmed");
  const amountPounds = formData.get("amount_pounds") ? Number(formData.get("amount_pounds")) : null;
  const recurring = formData.get("recurring") === "on";
  const recurrenceFreq = String(formData.get("recurrence_freq") || "weekly");
  const recurrenceUntil = String(formData.get("recurrence_until") || "").trim();
  const recurrenceCount = formData.get("recurrence_count") ? Number(formData.get("recurrence_count")) : 12;

  if (!roomId || !date || !startTime || !endTime || !bookerFirstName || !bookerLastName)
    return { error: "Room, date, times and the booker's first and last name are required." };
  if (!isValidDateString(date)) return { error: "Please enter a valid date." };
  if (!isValidTimeString(startTime) || !isValidTimeString(endTime))
    return { error: "Please enter valid start and end times." };

  // The form only offers confirmed/pending; anything else is a tampered post.
  const status: BookingStatus = statusInput === "pending" ? "pending" : "confirmed";

  const recurrenceGroupId = recurring ? crypto.randomUUID() : null;
  const extraDates = recurring
    ? generateRecurringDates(date, recurrenceFreq, recurrenceUntil, recurrenceCount)
    : [];

  const clashes = await findConflictingDates(admin, roomId, [date, ...extraDates], startTime, endTime);
  if (clashes.length > 0) return { error: conflictListMessage(clashes) };

  // The room's contacts book, not the members database: an emailed customer
  // gets (or refreshes) a contact; an email-less one stays snapshot-only.
  const contactId = await upsertBookingContact({
    firstName: bookerFirstName,
    lastName: bookerLastName,
    email: bookerEmail,
    phone: bookerPhone,
  }).catch(() => null);

  function rowFor(d: string): BookingInsert {
    const { startsAt, endsAt } = legacyWindowToInstants(d, startTime, endTime);
    return {
      resource_id: roomId,
      ...bookingPeriod(startsAt, endsAt),
      contact_id: contactId,
      booker_first_name: bookerFirstName,
      booker_last_name: bookerLastName,
      booker_name: bookerName,
      booker_email: bookerEmail || "—",
      booker_phone: bookerPhone,
      occasion,
      estimated_guests: estimatedGuests,
      notes,
      status,
      // Legacy `amount_pence` has no counterpart in `bookings`; the agreed
      // price is `total_pence`, which is what the portal and reminders read.
      total_pence: amountPounds ? Math.round(amountPounds * 100) : null,
      payment_status: formData.get("mark_paid") === "on" ? "paid" : "unpaid",
      recurrence_group_id: recurrenceGroupId,
    };
  }

  const { data: booking, error } = await admin
    .from("bookings")
    .insert(rowFor(date))
    .select("id")
    .single();

  if (error || !booking) {
    return { error: conflictOrMessage(error, error?.message ?? "Failed to create booking.") };
  }

  if (extraDates.length > 0) {
    const { error: extrasErr } = await admin
      .from("bookings")
      .insert(extraDates.map(rowFor));
    if (extrasErr) {
      return {
        error: conflictOrMessage(
          extrasErr,
          "The first booking was created but the repeats could not be saved.",
        ),
      };
    }
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "create_internal",
    entity: "room_booking",
    entityId: booking.id,
    detail: { booker: bookerName, date, resource_id: roomId, recurring, recurrenceGroupId },
  });

  revalidatePath("/room-bookings");
  redirect(`/room-bookings/${booking.id}`);
}


// ---------------------------------------------------------------------------
// Declining a block booking (Adam, 2026-08-26: "Admins need the ability to
// decline and delete block bookings in one go")
// ---------------------------------------------------------------------------
//
// A block booking is one request that becomes many rows — createBlockBooking()
// writes up to 104 of them sharing a `recurrence_group_id`. Turning one down
// used to mean two separate jobs done one row at a time: set each to cancelled
// (updateBookingStatus), then delete the series (deleteBookingsByGroup, and
// only a super user could). Twenty rows, forty clicks, two different ideas of
// who is allowed.
//
// This is the one decision it always was: the club says no, and the dates go
// back on the market. It is one call, and it is a COMMITTEE decision, not a
// super user one — `bookings_admin_delete` is `for delete using
// (is_club_admin())`, so the database has always said committee. The app was
// stricter than the database by accident.
//
// Deleting rather than cancelling is deliberate for a request that was never
// accepted: a cancelled row still occupies the diary's cancelled list for ever
// and still has to be read past. What must NOT vanish is the fact that the
// club was asked and said no — so the whole series is snapshotted into one
// audit row first, with every date in it, and the reason.

export type DeclineSeriesResult = { error?: string; deleted?: number };

export async function declineAndDeleteSeries(
  groupId: string,
  reason: string,
): Promise<DeclineSeriesResult> {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) {
    return { error: "Only a committee member or an administrator can decline a block booking." };
  }
  if (!groupId) return { error: "No series given." };
  const why = reason.trim();
  if (why.length < 3) {
    return { error: "Say why it is being declined — it goes in the record." };
  }

  const admin = createAdminClient();

  // Read the whole series BEFORE deleting: afterwards this audit row is the
  // only trace that the club was asked at all.
  const { data: rows, error: readError } = await admin
    .from("bookings")
    .select(
      "id,starts_at,ends_at,status,occasion,booker_first_name,booker_last_name,booker_email,booker_phone,resource_id,total_pence,payment_status,resources(name)",
    )
    .eq("recurrence_group_id", groupId)
    .order("starts_at");
  if (readError) return { error: "Could not read that series." };
  if (!rows?.length) return { error: "That series no longer exists." };

  const paid = rows.filter(
    (row) => row.payment_status === "paid" || row.payment_status === "deposit_paid",
  );
  if (paid.length > 0) {
    // Money has changed hands. Deleting the row it was taken against would
    // leave the payment attached to nothing, and arranging a refund is not
    // this button's job.
    return {
      error: `${paid.length} of these ${rows.length} bookings have been paid, or have a deposit against them. Sort the refund out first, then delete those individually.`,
    };
  }

  const first = rows[0];
  if (!first) return { error: "That series no longer exists." };
  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "decline_and_delete_series",
    entity: "room_booking",
    entityId: groupId,
    detail: {
      reason: why,
      recurrence_group_id: groupId,
      count: rows.length,
      room: (first.resources as { name?: string } | null)?.name ?? null,
      booker: {
        name: joinContactName(first.booker_first_name, first.booker_last_name),
        email: first.booker_email,
        phone: first.booker_phone,
      },
      occasion: first.occasion,
      occurrences: rows.map((row) => ({
        id: row.id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: row.status,
      })),
    },
  });

  const { error: deleteError, count } = await admin
    .from("bookings")
    .delete({ count: "exact" })
    .eq("recurrence_group_id", groupId);
  if (deleteError) return { error: "Failed to delete the series." };

  revalidatePath("/room-bookings");
  return { deleted: count ?? rows.length };
}

// ---------------------------------------------------------------------------
// The desk's older jobs, reinstated (Adam, 2026-09-03: "Do an audit of what
// used to be in the room booking part of the app and ensure it's all wired
// up"). The columns waited through the cutover; these are the moving parts.

/**
 * Send a quote: prices an enquiry (or a pending request) WITHOUT holding the
 * slot — the status becomes 'quoted', which `bookings_no_overlap` ignores
 * exactly as it ignores 'enquiry'. Confirming later is what takes the date.
 * The follow-up stamp is cleared so the cron can nudge once about THIS quote.
 */
export async function sendQuote(
  bookingId: string,
  input: { totalPence: number | null },
): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session || !isSuperUser(session.profile?.role)) return { error: "Not authorised." };
  if (!input.totalPence || input.totalPence <= 0) {
    return { error: "Give the quote a price." };
  }

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id,status,booker_name,booker_email,starts_at,ends_at,resources(name)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { error: "Booking not found." };
  if (booking.status === "confirmed" || booking.status === "cancelled") {
    return { error: "Only an enquiry or a pending request can be quoted." };
  }

  const { error } = await admin
    .from("bookings")
    .update({
      status: "quoted",
      total_pence: input.totalPence,
      quote_followup_sent_at: null,
    })
    .eq("id", bookingId);
  if (error) return { error: conflictOrMessage(error, "The database refused that.") };

  if (booking.booker_email) {
    try {
      const brandColor = await getEmailBrandColor().catch(() => undefined);
      const window = instantsToLocalWindow(booking.starts_at, booking.ends_at);
      const tpl = await renderEmailTemplate(
        "room_booking_quote",
        {
          name: booking.booker_name || "there",
          room_name: (booking.resources as { name: string } | null)?.name ?? "Function room",
          booking_date: formatBookingDate(window.date),
          start_time: window.startTime,
          end_time: window.endTime,
          total_cost: formatCurrency(input.totalPence),
          portal_url: `${getSiteUrl()}/portal`,
        },
        brandColor,
      );
      await sendEmail({
        to: booking.booker_email,
        ...tpl,
        template: "room_booking_quote",
        entity: "bookings",
        entityId: bookingId,
      });
    } catch (e) {
      console.error("[room-booking] quote email failed:", e);
    }
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "quote",
    entity: "room_booking",
    entityId: bookingId,
    detail: { total_pence: input.totalPence },
  });

  revalidatePath(`/room-bookings/${bookingId}`);
  revalidatePath("/room-bookings");
  return {};
}

/**
 * The 18th-birthday security deposit's other half: the club gives it back,
 * and the record says when, how and by whom — which is also what stops the
 * post-event nudge from asking again.
 */
export async function markSecurityDepositReturned(
  bookingId: string,
  input: { method: string; note: string | null },
): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session || !isSuperUser(session.profile?.role)) return { error: "Not authorised." };
  const method = input.method.trim();
  if (!method) return { error: "Say how it was returned." };

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id,security_deposit_pence,security_deposit_returned_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { error: "Booking not found." };
  if (!booking.security_deposit_pence) return { error: "This booking holds no security deposit." };
  if (booking.security_deposit_returned_at) return { error: "Already recorded as returned." };

  const { error } = await admin
    .from("bookings")
    .update({
      security_deposit_returned_at: new Date().toISOString(),
      security_deposit_returned_method: method,
      security_deposit_returned_note: input.note?.trim() || null,
    })
    .eq("id", bookingId);
  if (error) return { error: conflictOrMessage(error, "The database refused that.") };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "security_deposit_returned",
    entity: "room_booking",
    entityId: bookingId,
    detail: { method, amount_pence: booking.security_deposit_pence },
  });

  revalidatePath(`/room-bookings/${bookingId}`);
  return {};
}
