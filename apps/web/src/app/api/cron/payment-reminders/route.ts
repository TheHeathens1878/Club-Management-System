import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailBrandColor, getSettings, getRecipientEmails } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/template-engine";
import { sendEmail } from "@/lib/email";
import { deleteCalendarEvent } from "@/lib/calendar";
import { writeAudit } from "@/lib/audit";
import { formatCurrency, getSiteUrl } from "@/lib/utils";
import { addDays, formatBookingDate, instantsToLocalWindow, londonToday } from "@/lib/booking-time";

export const dynamic = "force-dynamic";

// London "today" (YYYY-MM-DD) and a date N days from now, for comparing against
// the date-typed deposit_due_date / balance_due_date columns. Those two stayed
// `date` in the unified schema, so this logic is unchanged by P1.6.
function dayOffset(days: number): string {
  return addDays(londonToday(), days);
}

type Booking = {
  id: string;
  booker_name: string;
  booker_email: string;
  starts_at: string;
  ends_at: string;
  total_pence: number | null;
  deposit_pence: number | null;
  deposit_due_date: string | null;
  balance_due_date: string | null;
  resources: { name: string } | null;
};

function roomNameOf(booking: Booking): string {
  return booking.resources?.name ?? "Function room";
}

async function paidMap(admin: ReturnType<typeof createAdminClient>, ids: string[]) {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const { data } = await admin.from("payments").select("booking_id,amount_pence").in("booking_id", ids);
  for (const p of data ?? []) {
    map.set(p.booking_id, (map.get(p.booking_id) ?? 0) + p.amount_pence);
  }
  return map;
}

// One string literal each: supabase-js derives the row type from the select
// text, and a concatenation would collapse it to `string`.
const SELECT =
  "id,booker_name,booker_email,starts_at,ends_at,total_pence,deposit_pence,deposit_due_date,balance_due_date,resources(name)";
const SELECT_WITH_CALENDAR =
  "id,booker_name,booker_email,starts_at,ends_at,total_pence,deposit_pence,deposit_due_date,balance_due_date,resources(name),calendar_event_id";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = dayOffset(0);
  const brandColor = await getEmailBrandColor().catch(() => "#1249bf");
  const portalUrl = `${getSiteUrl()}/portal`;
  let depositSent = 0;
  let balanceSent = 0;

  // --- Deposit reminders: due within 2 days (or overdue), deposit still short ---
  const { data: depositCandidates } = await admin
    .from("bookings")
    .select(SELECT)
    .eq("status", "confirmed")
    .is("deposit_reminder_sent_at", null)
    .gt("deposit_pence", 0)
    .not("deposit_due_date", "is", null)
    .lte("deposit_due_date", dayOffset(2));

  const depBookings: Booking[] = depositCandidates ?? [];
  const depPaid = await paidMap(admin, depBookings.map((b) => b.id));

  for (const b of depBookings) {
    const deposit = Number(b.deposit_pence ?? 0);
    const paid = depPaid.get(b.id) ?? 0;
    if (paid >= deposit) continue; // deposit already satisfied
    if (!b.booker_email) continue;
    try {
      const tpl = await renderEmailTemplate("deposit_reminder", {
        name: b.booker_name || "there",
        room_name: roomNameOf(b),
        booking_date: formatBookingDate(instantsToLocalWindow(b.starts_at, b.ends_at).date),
        deposit_amount: formatCurrency(deposit),
        deposit_due_date: b.deposit_due_date ? formatBookingDate(b.deposit_due_date) : "—",
        portal_url: portalUrl,
      }, brandColor);
      await sendEmail({ to: b.booker_email, ...tpl });
      await admin.from("bookings").update({ deposit_reminder_sent_at: new Date().toISOString() }).eq("id", b.id);
      depositSent++;
    } catch (e) {
      console.error("[cron] deposit reminder failed for", b.id, e);
    }
  }

  // --- Balance reminders: within the reminder window (balance_due_date reached), not paid in full ---
  const { data: balanceCandidates } = await admin
    .from("bookings")
    .select(SELECT)
    .eq("status", "confirmed")
    .is("balance_reminder_sent_at", null)
    .gt("total_pence", 0)
    .not("balance_due_date", "is", null)
    .lte("balance_due_date", today);

  const balBookings: Booking[] = balanceCandidates ?? [];
  const balPaid = await paidMap(admin, balBookings.map((b) => b.id));

  for (const b of balBookings) {
    const total = Number(b.total_pence ?? 0);
    const paid = balPaid.get(b.id) ?? 0;
    const outstanding = total - paid;
    if (outstanding <= 0) continue; // paid in full
    if (!b.booker_email) continue;
    try {
      const tpl = await renderEmailTemplate("balance_reminder", {
        name: b.booker_name || "there",
        room_name: roomNameOf(b),
        booking_date: formatBookingDate(instantsToLocalWindow(b.starts_at, b.ends_at).date),
        outstanding: formatCurrency(outstanding),
        balance_due_date: b.balance_due_date ? formatBookingDate(b.balance_due_date) : "—",
        portal_url: portalUrl,
      }, brandColor);
      await sendEmail({ to: b.booker_email, ...tpl });
      await admin.from("bookings").update({ balance_reminder_sent_at: new Date().toISOString() }).eq("id", b.id);
      balanceSent++;
    } catch (e) {
      console.error("[cron] balance reminder failed for", b.id, e);
    }
  }

  // --- Auto-cancel: deposit deadline passed and deposit still unpaid ---
  let autoCancelled = 0;
  const settings = await getSettings();
  if (settings.auto_cancel_unpaid !== "false") {
    const { data: cancelCandidates } = await admin
      .from("bookings")
      .select(SELECT_WITH_CALENDAR)
      .eq("status", "confirmed")
      .gt("deposit_pence", 0)
      .not("deposit_due_date", "is", null)
      .lt("deposit_due_date", today); // deadline is strictly in the past

    const cancelBookings: (Booking & { calendar_event_id: string | null })[] =
      cancelCandidates ?? [];
    const cancelPaid = await paidMap(admin, cancelBookings.map((b) => b.id));
    const ccAuto = await getRecipientEmails("notify_auto_cancellation").catch(() => []);

    for (const b of cancelBookings) {
      const deposit = Number(b.deposit_pence ?? 0);
      const paid = cancelPaid.get(b.id) ?? 0;
      if (paid >= deposit) continue; // deposit satisfied — leave it alone

      const dueStr = b.deposit_due_date ? formatBookingDate(b.deposit_due_date) : "the deadline";
      const reason = `The required deposit of ${formatCurrency(deposit)} was not received by ${dueStr}, so this booking has been cancelled.`;

      await admin
        .from("bookings")
        .update({ status: "cancelled", internal_notes: `Auto-cancelled: deposit not paid by ${b.deposit_due_date}` })
        .eq("id", b.id);

      if (b.calendar_event_id) deleteCalendarEvent(b.calendar_event_id).catch(() => {});

      if (b.booker_email) {
        try {
          const window = instantsToLocalWindow(b.starts_at, b.ends_at);
          const tpl = await renderEmailTemplate("room_booking_cancelled", {
            name: b.booker_name || "there",
            room_name: roomNameOf(b),
            booking_date: formatBookingDate(window.date),
            start_time: window.startTime,
            end_time: window.endTime,
            cancellation_reason: reason,
          }, brandColor);
          await sendEmail({ to: b.booker_email, cc: ccAuto, ...tpl });
        } catch (e) {
          console.error("[cron] auto-cancel email failed for", b.id, e);
        }
      }

      await writeAudit({
        actorId: null,
        actorEmail: "system (auto-cancel)",
        action: "cancel",
        entity: "room_booking",
        entityId: b.id,
        detail: { auto: true, reason: "deposit unpaid" },
      });
      autoCancelled++;
    }
  }

  return NextResponse.json({ ok: true, depositSent, balanceSent, autoCancelled });
}
