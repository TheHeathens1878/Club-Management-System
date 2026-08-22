import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailBrandColor, getSettings, getRecipientEmails } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/template-engine";
import { sendEmail } from "@/lib/email";
import { deleteCalendarEvent } from "@/lib/calendar";
import { writeAudit } from "@/lib/audit";
import { formatCurrency, getSiteUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

// London "today" (YYYY-MM-DD) and a date N days from now, for comparing against
// the date-typed deposit_due_date / balance_due_date columns.
const ukDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});
function dayOffset(days: number): string {
  return ukDate.format(new Date(Date.now() + days * 86_400_000));
}
function prettyDate(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}
function roomNameOf(row: unknown): string {
  const r = row as { name?: string } | { name?: string }[] | null;
  return Array.isArray(r) ? (r[0]?.name ?? "Function room") : (r?.name ?? "Function room");
}

type Booking = {
  id: string;
  booker_name: string | null;
  booker_email: string | null;
  date: string;
  total_pence: number | null;
  deposit_pence: number | null;
  deposit_due_date: string | null;
  balance_due_date: string | null;
  function_rooms: unknown;
};

async function paidMap(admin: ReturnType<typeof createAdminClient>, ids: string[]) {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const { data } = await admin.from("booking_payments").select("booking_id,amount_pence").in("booking_id", ids);
  for (const p of data ?? []) {
    map.set(p.booking_id as string, (map.get(p.booking_id as string) ?? 0) + Number(p.amount_pence ?? 0));
  }
  return map;
}

const SELECT = "id,booker_name,booker_email,date,total_pence,deposit_pence,deposit_due_date,balance_due_date,function_rooms(name)";

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
    .from("room_bookings")
    .select(SELECT)
    .eq("status", "confirmed")
    .is("deposit_reminder_sent_at", null)
    .gt("deposit_pence", 0)
    .not("deposit_due_date", "is", null)
    .lte("deposit_due_date", dayOffset(2));

  const depBookings = (depositCandidates ?? []) as unknown as Booking[];
  const depPaid = await paidMap(admin, depBookings.map((b) => b.id));

  for (const b of depBookings) {
    const deposit = Number(b.deposit_pence ?? 0);
    const paid = depPaid.get(b.id) ?? 0;
    if (paid >= deposit) continue; // deposit already satisfied
    if (!b.booker_email) continue;
    try {
      const tpl = await renderEmailTemplate("deposit_reminder", {
        name: b.booker_name ?? "there",
        room_name: roomNameOf(b.function_rooms),
        booking_date: prettyDate(b.date),
        deposit_amount: formatCurrency(deposit),
        deposit_due_date: b.deposit_due_date ? prettyDate(b.deposit_due_date) : "—",
        portal_url: portalUrl,
      }, brandColor);
      await sendEmail({ to: b.booker_email, ...tpl });
      await admin.from("room_bookings").update({ deposit_reminder_sent_at: new Date().toISOString() }).eq("id", b.id);
      depositSent++;
    } catch (e) {
      console.error("[cron] deposit reminder failed for", b.id, e);
    }
  }

  // --- Balance reminders: within the reminder window (balance_due_date reached), not paid in full ---
  const { data: balanceCandidates } = await admin
    .from("room_bookings")
    .select(SELECT)
    .eq("status", "confirmed")
    .is("balance_reminder_sent_at", null)
    .gt("total_pence", 0)
    .not("balance_due_date", "is", null)
    .lte("balance_due_date", today);

  const balBookings = (balanceCandidates ?? []) as unknown as Booking[];
  const balPaid = await paidMap(admin, balBookings.map((b) => b.id));

  for (const b of balBookings) {
    const total = Number(b.total_pence ?? 0);
    const paid = balPaid.get(b.id) ?? 0;
    const outstanding = total - paid;
    if (outstanding <= 0) continue; // paid in full
    if (!b.booker_email) continue;
    try {
      const tpl = await renderEmailTemplate("balance_reminder", {
        name: b.booker_name ?? "there",
        room_name: roomNameOf(b.function_rooms),
        booking_date: prettyDate(b.date),
        outstanding: formatCurrency(outstanding),
        balance_due_date: b.balance_due_date ? prettyDate(b.balance_due_date) : "—",
        portal_url: portalUrl,
      }, brandColor);
      await sendEmail({ to: b.booker_email, ...tpl });
      await admin.from("room_bookings").update({ balance_reminder_sent_at: new Date().toISOString() }).eq("id", b.id);
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
      .from("room_bookings")
      .select(SELECT + ",start_time,end_time,calendar_event_id")
      .eq("status", "confirmed")
      .gt("deposit_pence", 0)
      .not("deposit_due_date", "is", null)
      .lt("deposit_due_date", today); // deadline is strictly in the past

    const cancelBookings = (cancelCandidates ?? []) as unknown as (Booking & {
      start_time: string; end_time: string; calendar_event_id: string | null;
    })[];
    const cancelPaid = await paidMap(admin, cancelBookings.map((b) => b.id));
    const ccAuto = await getRecipientEmails("notify_auto_cancellation").catch(() => []);

    for (const b of cancelBookings) {
      const deposit = Number(b.deposit_pence ?? 0);
      const paid = cancelPaid.get(b.id) ?? 0;
      if (paid >= deposit) continue; // deposit satisfied — leave it alone

      const dueStr = b.deposit_due_date ? prettyDate(b.deposit_due_date) : "the deadline";
      const reason = `The required deposit of ${formatCurrency(deposit)} was not received by ${dueStr}, so this booking has been cancelled.`;

      await admin
        .from("room_bookings")
        .update({ status: "cancelled", internal_notes: `Auto-cancelled: deposit not paid by ${b.deposit_due_date}` })
        .eq("id", b.id);

      if (b.calendar_event_id) deleteCalendarEvent(b.calendar_event_id).catch(() => {});

      if (b.booker_email) {
        try {
          const tpl = await renderEmailTemplate("room_booking_cancelled", {
            name: b.booker_name ?? "there",
            room_name: roomNameOf(b.function_rooms),
            booking_date: prettyDate(b.date),
            start_time: String(b.start_time).slice(0, 5),
            end_time: String(b.end_time).slice(0, 5),
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
