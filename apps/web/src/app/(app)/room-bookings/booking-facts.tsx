/**
 * One hire, at a glance: the band of facts, the cost in its parts, and the
 * Total / Paid / Outstanding triple (P8.1).
 *
 * This was three `<Card>`s of hand-written `<dl>`s on the booking page, each
 * with its own type size and its own idea of what a label looks like. The desk
 * reads them dozens of times a day and only ever wants the same eight things
 * first — which room, which night, which hours, how many people, what for,
 * where it stands, what came off, and whether the booker has said yes — so
 * they are tiles, two across on a phone and four on a desk.
 *
 * Nothing here talks to Supabase and nothing here is `"use client"`: the page
 * hands in a row and the figures `bookingMoney()` worked out, so the same
 * component draws the record page and the render fixture.
 */

import {
  BadgeCheck,
  BellRing,
  CalendarCheck2,
  CalendarDays,
  CheckCheck,
  Clock,
  DoorOpen,
  FileText,
  PartyPopper,
  Percent,
  PoundSterling,
  RotateCcw,
  Send,
  TriangleAlert,
  Undo2,
  Users,
} from "lucide-react";
import type { Database } from "@club/db";

import { StatRow, StatTile, type StatTone } from "@/components/ui/stat-tile";
import { extrasSummary } from "@/lib/booking-extras";
import type { BookingActionKey, BookingMoney } from "@/lib/booking-next-action";
import { formatBookingDate, type BookingWindow } from "@/lib/booking-time";
import { formatCurrency } from "@/lib/utils";

type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];

/** Exactly the columns the band and the cost card read. */
export type BookingFactsRow = Pick<
  BookingRow,
  | "status"
  | "estimated_guests"
  | "occasion"
  | "base_hire_pence"
  | "extras_total_pence"
  | "selected_extras"
  | "member_discount_pence"
  | "member_checked_at"
  | "member_checked_by_email"
  | "final_chaser_discount_pence"
  | "quote_accepted_at"
  | "total_pence"
  | "security_deposit_pence"
  | "is_member"
  | "membership_type"
  | "member_number"
  | "team_name"
  | "child_name"
  | "child_team"
>;

/** "3 Sep 2026" — the short day a stamp is read as. */
function stampDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * What a status means, said once. `enquiry` and `quoted` are deliberately the
 * quiet tone: asking is free and neither is holding the room, which is the
 * single fact the desk most often gets wrong.
 */
export function bookingStatusLook(status: string): {
  tone: StatTone;
  badge: "success" | "muted" | "destructive" | "default" | "warning";
  hint: string;
} {
  if (status === "confirmed") return { tone: "success", badge: "success", hint: "Holding the room" };
  if (status === "cancelled") return { tone: "danger", badge: "destructive", hint: "Not holding the room" };
  if (status === "pending") return { tone: "warning", badge: "warning", hint: "Holding the room" };
  return { tone: "default", badge: "default", hint: "Not holding the room" };
}

/**
 * The icon for the one thing this booking needs next, keyed on the same
 * `key` `bookingNextAction()` returns — rendered, because the bar it feeds is
 * drawn by a client component and a function cannot cross that boundary.
 */
export function bookingActionIcon(key: BookingActionKey): React.ReactNode {
  const cls = "h-4 w-4";
  switch (key) {
    case "reply-alternatives":
      return <TriangleAlert className={cls} aria-hidden />;
    case "send-quote":
      return <FileText className={cls} aria-hidden />;
    case "confirm-accepted":
    case "confirm-booking":
      return <CalendarCheck2 className={cls} aria-hidden />;
    case "send-chaser":
      return <Send className={cls} aria-hidden />;
    case "final-offer":
      return <Percent className={cls} aria-hidden />;
    case "set-terms":
      return <TriangleAlert className={cls} aria-hidden />;
    case "chase-deposit":
    case "chase-balance":
      return <BellRing className={cls} aria-hidden />;
    case "await-deposit":
    case "await-balance":
      return <Clock className={cls} aria-hidden />;
    case "return-security":
      return <Undo2 className={cls} aria-hidden />;
    case "re-quote":
      return <RotateCcw className={cls} aria-hidden />;
    case "paid-in-full":
    default:
      return <CheckCheck className={cls} aria-hidden />;
  }
}

/** What the cost card is called depends on whether the price is settled yet. */
function costTitle(status: string): string {
  if (status === "enquiry" || status === "pending") return "Estimated cost";
  if (status === "confirmed") return "Agreed cost";
  return "Quoted cost";
}

function Line({
  label,
  value,
  muted = false,
  strong = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={
        "flex justify-between gap-4 " +
        (strong ? "border-t pt-1.5 font-semibold " : "") +
        (muted ? "text-muted-foreground" : "")
      }
    >
      <dt className={strong || muted ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export function BookingFacts({
  booking,
  roomName,
  when,
  money,
  paymentHref,
}: {
  booking: BookingFactsRow;
  roomName: string;
  /** The London wall clock the page has always shown. */
  when: BookingWindow;
  money: BookingMoney;
  /**
   * Where "Paid" and "Outstanding" lead — `?sheet=payment` on the record. A
   * figure that is wrong is a figure somebody wants to change, so the tile
   * showing it is the door to the ledger behind it.
   */
  paymentHref?: string;
}) {
  const look = bookingStatusLook(booking.status);
  const discount = booking.member_discount_pence ?? 0;
  const extras = extrasSummary(booking.selected_extras);
  const memberClaim =
    [booking.membership_type, booking.member_number].filter(Boolean).join(" · ") ||
    (booking.is_member ? "Claimed, unchecked" : null);
  const showCost =
    booking.total_pence !== null || booking.base_hire_pence > 0 || booking.extras_total_pence > 0;

  return (
    <div className="space-y-4">
      <StatRow>
        <StatTile label="Room" value={roomName} icon={<DoorOpen className="h-3.5 w-3.5" aria-hidden />} />
        <StatTile
          label="Date"
          value={formatBookingDate(when.date)}
          icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />}
        />
        <StatTile
          label="Time"
          value={`${when.startTime}–${when.endTime}`}
          icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
        />
        <StatTile
          label="Guests"
          value={booking.estimated_guests === null ? "—" : String(booking.estimated_guests)}
          hint={booking.estimated_guests === null ? "Not given" : "Estimated on the form"}
          icon={<Users className="h-3.5 w-3.5" aria-hidden />}
        />
        <StatTile
          label="Occasion"
          value={booking.occasion || "—"}
          hint={
            booking.child_name
              ? [booking.child_name, booking.child_team].filter(Boolean).join(" — ")
              : (booking.team_name ?? undefined)
          }
          icon={<PartyPopper className="h-3.5 w-3.5" aria-hidden />}
        />
        <StatTile
          label="Status"
          value={<span className="capitalize">{booking.status}</span>}
          hint={look.hint}
          tone={look.tone}
          icon={<BadgeCheck className="h-3.5 w-3.5" aria-hidden />}
        />
        <StatTile
          label="Member discount"
          value={discount > 0 ? `−${formatCurrency(discount)}` : "None"}
          hint={
            booking.member_checked_at
              ? `Checked by ${booking.member_checked_by_email ?? "staff"}, ${stampDay(booking.member_checked_at)}`
              : (memberClaim ?? "No claim on this booking")
          }
          tone={discount > 0 ? "success" : "default"}
          icon={<PoundSterling className="h-3.5 w-3.5" aria-hidden />}
        />
        <StatTile
          label="Quote accepted"
          value={booking.quote_accepted_at ? stampDay(booking.quote_accepted_at) : "—"}
          hint={booking.quote_accepted_at ? "By the booker, in their portal" : "Not accepted yet"}
          tone={booking.quote_accepted_at ? "success" : "default"}
          icon={<CheckCheck className="h-3.5 w-3.5" aria-hidden />}
        />
      </StatRow>

      {showCost && (
        <div className="rounded-xl border bg-card p-4 shadow-sm lg:p-5">
          <p className="text-row font-semibold leading-tight">{costTitle(booking.status)}</p>

          {/* The cost in its parts (Adam, 2026-09-11: "the cost details need to
              pull through to enquiries"). The public form records the room hire
              and the extras separately; older rows carry only a total. */}
          <dl className="mt-2 space-y-1.5 text-list">
            {booking.base_hire_pence > 0 && (
              <Line
                label={`Room hire (${when.startTime}–${when.endTime})`}
                value={formatCurrency(booking.base_hire_pence)}
              />
            )}
            {booking.extras_total_pence > 0 && (
              <Line
                label={`Extras${extras ? ` — ${extras}` : ""}`}
                value={formatCurrency(booking.extras_total_pence)}
              />
            )}
            {discount > 0 && <Line label="Member discount" value={`−${formatCurrency(discount)}`} />}
            {(booking.final_chaser_discount_pence ?? 0) > 0 && (
              <Line
                label="Final offer — half off room hire"
                value={`−${formatCurrency(booking.final_chaser_discount_pence ?? 0)}`}
              />
            )}
            <Line
              label="Total"
              value={booking.total_pence !== null ? formatCurrency(booking.total_pence) : "—"}
              strong
            />
            {money.securityDepositPence > 0 && (
              <Line
                label="Refundable security deposit, on top"
                value={formatCurrency(money.securityDepositPence)}
                muted
              />
            )}
          </dl>

          {/* The triple every money screen in the app now says the same way.
              The security deposit is HELD, not earned, so it is not in any of
              these three figures — it gets its own line above. */}
          <StatRow className="mt-3 grid-cols-3 lg:grid-cols-3">
            <StatTile
              label="Total"
              value={money.totalPence > 0 ? formatCurrency(money.totalPence) : "—"}
            />
            <StatTile
              label="Paid"
              value={formatCurrency(money.hirePaidPence)}
              href={paymentHref}
              tone={money.hirePaidPence > 0 ? "success" : "default"}
              hint={
                money.depositPence > 0
                  ? `Deposit ${formatCurrency(money.depositPence)} ${money.depositOutstandingPence <= 0 ? "paid" : "outstanding"}`
                  : undefined
              }
            />
            <StatTile
              label="Outstanding"
              value={money.totalPence > 0 ? formatCurrency(money.outstandingPence) : "—"}
              href={paymentHref}
              tone={money.outstandingPence > 0 ? "warning" : "success"}
              hint={
                money.securityOutstandingPence > 0
                  ? `+ ${formatCurrency(money.securityOutstandingPence)} security deposit`
                  : undefined
              }
            />
          </StatRow>

          {(booking.status === "enquiry" || booking.status === "pending") && (
            <p className="mt-2 text-xs text-muted-foreground">
              The public form&apos;s estimate at the room&apos;s current prices. Send a quote to put the
              club&apos;s price on it; a member discount is applied at confirmation once the claim is
              checked.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
