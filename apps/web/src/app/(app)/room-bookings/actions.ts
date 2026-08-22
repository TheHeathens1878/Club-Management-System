"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile, isCommittee, isStaff, isSuperUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { renderEmailTemplate } from "@/lib/template-engine";
import { getEmailBrandColor, getSettings, getRecipientEmails } from "@/lib/settings";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/calendar";
import { formatCurrency, getSiteUrl } from "@/lib/utils";

async function requireStaff() {
  const session = await getSessionProfile();
  if (!session || !isStaff(session.profile?.role)) redirect("/room-bookings");
  return session;
}

async function requireCommittee() {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) redirect("/room-bookings");
  return session;
}

export async function confirmBooking(
  bookingId: string,
  opts?: { totalPence?: number | null; depositPence?: number | null },
): Promise<{ error?: string }> {
  const session = await requireStaff();
  const admin = createAdminClient();

  const { data: booking, error: fetchErr } = await admin
    .from("room_bookings")
    .select("booker_name,booker_email,date,start_time,end_time,occasion,estimated_guests,amount_pence,payment_status,function_rooms(name)")
    .eq("id", bookingId)
    .maybeSingle();

  if (fetchErr || !booking) return { error: "Booking not found." };

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

  const bookingDate = new Date(String(booking.date) + "T12:00:00");
  const balanceDue = new Date(bookingDate);
  balanceDue.setDate(balanceDue.getDate() - balanceDays);
  const balanceDueStr = balanceDue.toISOString().slice(0, 10);

  // Create calendar event before status update so we can store the event ID
  const roomRow = booking.function_rooms as { name: string } | { name: string }[] | null;
  const roomName = Array.isArray(roomRow) ? (roomRow[0]?.name ?? "Function Room") : (roomRow?.name ?? "Function Room");
  const calEventId = await createCalendarEvent({
    date: String(booking.date),
    start_time: String(booking.start_time),
    end_time: String(booking.end_time),
    room_name: roomName,
    booker_name: booking.booker_name as string,
    occasion: booking.occasion as string | null,
    estimated_guests: booking.estimated_guests as number | null,
  }).catch(() => null);

  const { error } = await admin
    .from("room_bookings")
    .update({
      status: "confirmed",
      total_pence: totalPence,
      deposit_pence: depositPence,
      deposit_due_date: depositDueStr,
      balance_due_date: balanceDueStr,
      ...(calEventId ? { calendar_event_id: calEventId } : {}),
    })
    .eq("id", bookingId);

  if (error) return { error: "Failed to confirm booking." };

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
        const dateFormatted = new Date(String(booking.date) + "T12:00:00").toLocaleDateString("en-GB", {
          weekday: "long", day: "numeric", month: "long", year: "numeric",
        });
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
          name: booking.booker_name as string,
          room_name: roomName,
          booking_date: dateFormatted,
          start_time: String(booking.start_time).slice(0, 5),
          end_time: String(booking.end_time).slice(0, 5),
          occasion: (booking.occasion as string | null) ?? "Private hire",
          payment_status: paymentStatusText,
          total_cost: totalPence ? formatCurrency(totalPence) : "—",
          deposit_amount: depositPence > 0 ? formatCurrency(depositPence) : "—",
          deposit_due_date: depositPence > 0 ? depositDueFormatted : "—",
          portal_url: `${getSiteUrl()}/portal`,
        }, brandColor);

        await sendEmail({ to: booking.booker_email as string, ...tpl });
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
    .from("room_bookings")
    .select("booker_name,booker_email,date,start_time,end_time,calendar_event_id,function_rooms(name)")
    .eq("id", bookingId)
    .maybeSingle();

  if (fetchErr || !booking) return { error: "Booking not found." };

  const { error } = await admin
    .from("room_bookings")
    .update({ status: "cancelled", internal_notes: `Cancellation reason: ${reason.trim()}` })
    .eq("id", bookingId);

  if (error) return { error: "Failed to cancel booking." };

  // Remove the calendar event if one was created
  const calEventId = (booking as Record<string, unknown>).calendar_event_id as string | null;
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
        const cancelRoomRow = booking.function_rooms as { name: string } | { name: string }[] | null;
        const cancelRoomName = Array.isArray(cancelRoomRow) ? (cancelRoomRow[0]?.name ?? "Function Room") : (cancelRoomRow?.name ?? "Function Room");
        const dateFormatted = new Date(String(booking.date) + "T12:00:00").toLocaleDateString("en-GB", {
          weekday: "long", day: "numeric", month: "long", year: "numeric",
        });
        const tpl = await renderEmailTemplate("room_booking_cancelled", {
          name: booking.booker_name as string,
          room_name: cancelRoomName,
          booking_date: dateFormatted,
          start_time: String(booking.start_time).slice(0, 5),
          end_time: String(booking.end_time).slice(0, 5),
          cancellation_reason: reason.trim(),
        }, brandColor);
        const cc = await getRecipientEmails("notify_cancellation").catch(() => []);
        await sendEmail({ to: booking.booker_email as string, cc, ...tpl });
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

  if (!["pending", "confirmed", "cancelled"].includes(status)) {
    return { error: "Invalid status." };
  }

  const { error } = await admin
    .from("room_bookings")
    .update({ status })
    .eq("id", bookingId);

  if (error) return { error: "Failed to update status." };

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
    .from("room_bookings")
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
    room_id: string;
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

  const admin = createAdminClient();
  const { error } = await admin
    .from("room_bookings")
    .update(fields)
    .eq("id", bookingId);

  if (error) return { error: "Failed to update booking." };

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

// Recompute payment_status from the sum of booking_payments vs total/deposit.
// Returns the new totals so callers can use them (e.g. for emails).
async function recomputePaymentStatus(
  admin: ReturnType<typeof createAdminClient>,
  bookingId: string,
): Promise<{ totalPence: number; depositPence: number; paidPence: number }> {
  const [{ data: booking }, { data: payments }] = await Promise.all([
    admin.from("room_bookings").select("total_pence,deposit_pence,amount_pence").eq("id", bookingId).maybeSingle(),
    admin.from("booking_payments").select("amount_pence").eq("booking_id", bookingId),
  ]);

  const totalPence = Number(booking?.total_pence ?? booking?.amount_pence ?? 0);
  const depositPence = Number(booking?.deposit_pence ?? 0);
  const paidPence = (payments ?? []).reduce((acc, p) => acc + Number(p.amount_pence ?? 0), 0);

  let status: string;
  if (totalPence > 0 && paidPence >= totalPence) status = "paid";
  else if (depositPence > 0 && paidPence >= depositPence) status = "deposit_paid";
  else if (paidPence > 0) status = "deposit_paid";
  else status = "unpaid";

  await admin.from("room_bookings").update({ payment_status: status }).eq("id", bookingId);
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

  const { error: insertErr } = await admin.from("booking_payments").insert({
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
          .from("room_bookings")
          .select("booker_name,booker_email,date,function_rooms(name)")
          .eq("id", bookingId)
          .maybeSingle();
        if (booking?.booker_email && booking.booker_email !== "—") {
          const brandColor = await getEmailBrandColor().catch(() => "#1249bf");
          const roomName = (booking as Record<string, unknown>).function_rooms
            ? ((booking as Record<string, unknown>).function_rooms as { name?: string }).name ?? "Function room"
            : "Function room";
          const outstanding = Math.max(0, totalPence - paidPence);
          const tpl = await renderEmailTemplate("payment_received", {
            name: booking.booker_name as string,
            room_name: roomName,
            booking_date: new Date(String(booking.date) + "T12:00:00").toLocaleDateString("en-GB", {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
            }),
            amount_paid: formatCurrency(input.amount_pence),
            total_paid: formatCurrency(paidPence),
            outstanding: totalPence > 0 ? formatCurrency(outstanding) : "—",
            payment_method: (input.method || "—").replace("_", " "),
          }, brandColor);
          await sendEmail({ to: booking.booker_email as string, ...tpl });
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
    .from("booking_payments")
    .select("source")
    .eq("id", paymentId)
    .maybeSingle();
  if (payment?.source === "sumup") return { error: "SumUp payments cannot be deleted." };

  const { error } = await admin.from("booking_payments").delete().eq("id", paymentId);
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
  const resources = String(formData.get("resources") ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  if (!id) redirect(`/room-bookings/rooms?error=${encodeURIComponent("Room ID missing.")}`);
  if (!name) redirect(`/room-bookings/rooms?error=${encodeURIComponent("Room name is required.")}`);

  const { error } = await admin
    .from("function_rooms")
    .update({
      name, description, capacity, active, resources,
      price_pence_per_hour: pricePerHour,
      price_pence_half_day: priceHalfDay,
      price_pence_full_day: priceFullDay,
      price_pence_fixed: priceFixed,
      price_note: priceNote,
    })
    .eq("id", id);

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
    .from("function_rooms")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = ((last?.[0]?.sort_order as number) ?? 0) + 10;

  const { error } = await admin.from("function_rooms").insert({
    name, description, capacity, active: true, sort_order: nextSort,
  });
  if (error) redirect(`/room-bookings/rooms?error=${encodeURIComponent("Failed to create room: " + error.message)}`);

  revalidatePath("/room-bookings/rooms");
  redirect("/room-bookings/rooms?saved=new");
}

export async function deleteRoom(roomId: string): Promise<void> {
  await requireCommittee();
  const admin = createAdminClient();
  const { error } = await admin.from("function_rooms").delete().eq("id", roomId);
  if (error) redirect(`/room-bookings/rooms?error=${encodeURIComponent("Failed to delete room: " + error.message)}`);
  revalidatePath("/room-bookings/rooms");
  redirect("/room-bookings/rooms");
}

export async function deleteBooking(bookingId: string): Promise<{ error?: string }> {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) return { error: "Not authorised." };

  const admin = createAdminClient();
  const { error } = await admin.from("room_bookings").delete().eq("id", bookingId);
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
  const { error } = await admin.from("room_bookings").delete().in("id", ids);
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
  const { error } = await admin.from("room_bookings").delete().eq("recurrence_group_id", groupId);
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

  const recurrenceGroupId = recurring ? crypto.randomUUID() : null;

  const baseRow = {
    room_id: roomId,
    date,
    start_time: startTime,
    end_time: endTime,
    booker_name: "Club",
    booker_email: "—",
    occasion: reason,
    status: "confirmed",
    booking_type: "block",
    recurrence_group_id: recurrenceGroupId,
  };

  const { data: booking, error } = await admin
    .from("room_bookings")
    .insert(baseRow)
    .select("id")
    .single();

  if (error) return { error: error.message };

  if (recurring) {
    const extraDates = generateRecurringDates(date, recurrenceFreq, recurrenceUntil, recurrenceCount);
    if (extraDates.length > 0) {
      await admin.from("room_bookings").insert(
        extraDates.map((d) => ({ ...baseRow, date: d }))
      );
    }
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "create_block",
    entity: "room_booking",
    entityId: booking.id,
    detail: { date, room_id: roomId, reason, recurring, recurrenceFreq, recurrenceGroupId },
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
  const bookerName = String(formData.get("booker_name") || "").trim();
  const bookerEmail = String(formData.get("booker_email") || "").trim();
  const bookerPhone = String(formData.get("booker_phone") || "").trim() || null;
  const occasion = String(formData.get("occasion") || "").trim() || null;
  const estimatedGuests = formData.get("estimated_guests") ? Number(formData.get("estimated_guests")) : null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const status = String(formData.get("status") || "confirmed");
  const amountPounds = formData.get("amount_pounds") ? Number(formData.get("amount_pounds")) : null;
  const recurring = formData.get("recurring") === "on";
  const recurrenceFreq = String(formData.get("recurrence_freq") || "weekly");
  const recurrenceUntil = String(formData.get("recurrence_until") || "").trim();
  const recurrenceCount = formData.get("recurrence_count") ? Number(formData.get("recurrence_count")) : 12;

  if (!roomId || !date || !startTime || !endTime || !bookerName)
    return { error: "Room, date, times and booker name are required." };

  const recurrenceGroupId = recurring ? crypto.randomUUID() : null;

  const baseRow = {
    room_id: roomId,
    date,
    start_time: startTime,
    end_time: endTime,
    booker_name: bookerName,
    booker_email: bookerEmail || "—",
    booker_phone: bookerPhone,
    occasion,
    estimated_guests: estimatedGuests,
    notes,
    status,
    amount_pence: amountPounds ? Math.round(amountPounds * 100) : null,
    payment_status: formData.get("mark_paid") === "on" ? "paid" : "unpaid",
    recurrence_group_id: recurrenceGroupId,
  };

  const { data: booking, error } = await admin
    .from("room_bookings")
    .insert(baseRow)
    .select("id")
    .single();

  if (error) return { error: error.message };

  if (recurring) {
    const extraDates = generateRecurringDates(date, recurrenceFreq, recurrenceUntil, recurrenceCount);
    if (extraDates.length > 0) {
      await admin.from("room_bookings").insert(
        extraDates.map((d) => ({ ...baseRow, date: d }))
      );
    }
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "create_internal",
    entity: "room_booking",
    entityId: booking.id,
    detail: { booker: bookerName, date, room_id: roomId, recurring, recurrenceGroupId },
  });

  revalidatePath("/room-bookings");
  redirect(`/room-bookings/${booking.id}`);
}
