"use client";

/**
 * The hirer's own bookings, each as one card, and the thin sheet behind a tap
 * (P8.9). This is NOT the desk's booking sheet: a hirer has three things to
 * do with a booking — read what they agreed to, pay the next thing owed, and
 * accept a quote — and nothing else on this side of the counter, so the modes
 * are `view`, `pay` and `accept` and there is no editing anywhere in it.
 *
 * Every figure, sentence and state on these cards was worked out on the
 * server by `bookingNextAction()` / `bookingMoney()` / `paymentRail()` and
 * arrives as plain data. That is deliberate: the desk's screen asks the same
 * functions the same questions in the desk's voice, so the two sides of the
 * counter cannot end up telling different stories about the same booking.
 *
 * The sheet is keyed on the booking's id, so a `router.refresh()` after a
 * payment lands leaves it open on the booking it was opened on.
 */

import { useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  FileCheck2,
  Info,
  Receipt,
} from "lucide-react";

import { ActionBar } from "@/components/ui/action-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Sheet } from "@/components/ui/sheet";
import { StatRow, StatTile } from "@/components/ui/stat-tile";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { BookingMoney, BookingNextAction, PaymentStep } from "@/lib/booking-next-action";
import { formatCurrency } from "@/lib/utils";

import { AcceptQuoteButton } from "./accept-quote-button";
import { PayButton } from "./pay-button";
import { PAY_LABEL, PaymentRail } from "./payment-rail";

/** One booking, as the server worked it out. Everything here is serializable. */
export type PortalBooking = {
  id: string;
  roomName: string;
  /** "Saturday, 18 October 2026". */
  dateLabel: string;
  /** "Sat, 18 Oct 2026" — for a folded summary, where the long form will not fit. */
  shortDateLabel: string;
  /** "19:00–23:00". */
  timeLabel: string;
  occasion: string | null;
  status: string;
  statusLabel: string;
  statusTone: "success" | "warning" | "muted" | "destructive";
  extras: string | null;
  /** True while the club has not taken the date: an enquiry or a quote. */
  roomNotHeld: boolean;
  /** The club's terms in one sentence, from `hireTermsSummary()`. */
  termsSummary: string;
  action: BookingNextAction;
  money: BookingMoney;
  rail: PaymentStep[];
  /** Confirmed and priced — the rail and the money band only make sense then. */
  priced: boolean;
  /** The one case the state machine has no money for: a booking that costs nothing. */
  note: string | null;
};

type Mode = "view" | "pay" | "accept";

const MODE_LABEL: Record<Mode, string> = {
  view: "Your booking",
  pay: "Pay",
  accept: "Accept the quote",
};

/** The bar's icon: what the booking wants, at a glance, before any reading. */
function barIcon(booking: PortalBooking) {
  if (booking.action.tone === "error") return <AlertTriangle className="h-4 w-4" aria-hidden />;
  if (booking.action.purpose) return <CreditCard className="h-4 w-4" aria-hidden />;
  if (booking.action.mode === "accept") return <FileCheck2 className="h-4 w-4" aria-hidden />;
  if (booking.action.tone === "done") return <CheckCircle2 className="h-4 w-4" aria-hidden />;
  if (booking.action.tone === "waiting" || booking.action.tone === "pending") {
    return <Clock className="h-4 w-4" aria-hidden />;
  }
  return <CalendarDays className="h-4 w-4" aria-hidden />;
}

/** The modes this booking actually has, in the order the sheet offers them. */
function modesFor(booking: PortalBooking): Mode[] {
  const modes: Mode[] = ["view"];
  if (booking.priced && booking.rail.some((step) => step.state === "due" || step.state === "overdue")) {
    modes.push("pay");
  }
  if (booking.action.mode === "accept") modes.push("accept");
  return modes;
}

export function PortalBookings({
  bookings,
  sumupEnabled,
}: {
  bookings: PortalBooking[];
  sumupEnabled: boolean;
}) {
  const [open, setOpen] = useState<{ id: string; mode: Mode } | null>(null);
  const shown = open ? (bookings.find((booking) => booking.id === open.id) ?? null) : null;

  return (
    <>
      <div className="space-y-4">
        {bookings.map((booking) => (
          <BookingCard
            key={booking.id}
            booking={booking}
            sumupEnabled={sumupEnabled}
            onOpen={(mode) => setOpen({ id: booking.id, mode })}
          />
        ))}
      </div>

      {shown ? (
        <BookingSheet
          booking={shown}
          mode={open?.mode ?? "view"}
          sumupEnabled={sumupEnabled}
          onMode={(mode) => setOpen({ id: shown.id, mode })}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function BookingCard({
  booking,
  sumupEnabled,
  onOpen,
}: {
  booking: PortalBooking;
  sumupEnabled: boolean;
  onOpen: (mode: Mode) => void;
}) {
  const { action, money } = booking;

  // The ONE button. A purpose and an amount mean there is money to move, so
  // it is the real `PayButton` with its own terms tick and its own SumUp
  // widget; a quote waiting on the hirer is `AcceptQuoteButton`; anything
  // else is waiting on the club, and the press opens the booking.
  const primary = action.purpose ? (
    <PayButton
      bookingId={booking.id}
      amountPence={action.amountPence ?? 0}
      label={PAY_LABEL[action.purpose]}
      purpose={action.purpose}
      sumupEnabled={sumupEnabled}
    />
  ) : action.mode === "accept" ? (
    <Button type="button" size="touch" onClick={() => onOpen("accept")}>
      Accept the quote
    </Button>
  ) : (
    <Button type="button" variant="outline" size="touch" onClick={() => onOpen("view")}>
      View booking
    </Button>
  );

  return (
    <article className="space-y-3 rounded-xl border bg-card p-4 shadow-sm lg:p-5">
      {/* The status goes ABOVE the date on a phone. Beside it, "Enquiry — room
          not held" is wider than the date it would have to share the line
          with, and the date is what a hirer opens this page to check. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between lg:gap-3">
        <button
          type="button"
          onClick={() => onOpen("view")}
          className="touch -m-1 order-last flex min-w-0 flex-1 flex-col items-start rounded-lg p-1 text-left transition-colors hover:bg-secondary/50 lg:order-first"
        >
          <span className="block text-row font-semibold leading-tight">{booking.roomName}</span>
          <span className="block text-sm text-muted-foreground">{booking.dateLabel}</span>
          <span className="block text-sm text-muted-foreground">
            {booking.timeLabel}
            {booking.occasion ? ` · ${booking.occasion}` : ""}
          </span>
        </button>
        <Badge variant={booking.statusTone} className="order-first w-fit flex-none lg:order-last">
          {booking.statusLabel}
        </Badge>
      </div>

      <ActionBar
        icon={barIcon(booking)}
        tone={action.tone}
        status={action.label}
        detail={action.why}
        action={primary}
      />

      {booking.priced ? (
        <>
          {/* Three across even on a phone: the figures are short and the
              triple is one fact, not three, so it should not wrap. */}
          <StatRow className="grid-cols-3 lg:grid-cols-3">
            <StatTile
              label="Total"
              value={formatCurrency(money.totalPence)}
              icon={<Receipt className="h-3.5 w-3.5" aria-hidden />}
            />
            <StatTile
              label="Paid"
              value={formatCurrency(money.hirePaidPence)}
              tone={money.hirePaidPence > 0 ? "success" : "default"}
            />
            <StatTile
              label="Outstanding"
              value={formatCurrency(money.outstandingPence)}
              tone={money.outstandingPence > 0 ? "warning" : "success"}
            />
          </StatRow>

          <PaymentRail
            bookingId={booking.id}
            steps={booking.rail}
            sumupEnabled={sumupEnabled}
            primaryPurpose={action.purpose}
          />
        </>
      ) : null}

      {/* The commercial commitment, kept word for word. A quote says the same
          thing in its status bar and again in the sheet's accept mode, so only
          an enquiry needs saying twice. */}
      {booking.status === "enquiry" ? (
        <Callout tone="warning" icon={<Info className="h-4 w-4" aria-hidden />}>
          This is an enquiry only — the room is <strong>not held</strong> for you, and the date stays
          open to other bookings until the club confirms one with you.
        </Callout>
      ) : null}

      {booking.note ? <p className="text-sm text-muted-foreground">{booking.note}</p> : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

function BookingSheet({
  booking,
  mode,
  sumupEnabled,
  onMode,
  onClose,
}: {
  booking: PortalBooking;
  mode: Mode;
  sumupEnabled: boolean;
  onMode: (mode: Mode) => void;
  onClose: () => void;
}) {
  const modes = modesFor(booking);
  const current = modes.includes(mode) ? mode : "view";
  const { money } = booking;

  // Paying everything owed in one go, which the portal has always allowed:
  // the rail asks for the deposit first because that is the order of the
  // terms, and this is the way past it for somebody who would rather be done.
  const payInFull =
    money.depositOutstandingPence > 0 && money.outstandingPence > money.depositOutstandingPence;

  return (
    <Sheet
      open
      onClose={onClose}
      title={booking.roomName}
      subtitle={`${booking.dateLabel} · ${booking.timeLabel}`}
    >
      <div className="space-y-4">
        {modes.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {modes.map((each) => (
              <ToggleChip key={each} on={each === current} size="sm" onClick={() => onMode(each)}>
                {MODE_LABEL[each]}
              </ToggleChip>
            ))}
          </div>
        ) : null}

        {current === "view" ? (
          <div className="space-y-3">
            <dl className="divide-y rounded-lg border">
              <Fact label="Status" value={booking.statusLabel} />
              <Fact label="Room" value={booking.roomName} />
              <Fact label="Date" value={booking.dateLabel} />
              <Fact label="Time" value={booking.timeLabel} />
              {booking.occasion ? <Fact label="Occasion" value={booking.occasion} /> : null}
              {booking.extras ? <Fact label="Extras" value={booking.extras} /> : null}
              {booking.priced ? (
                <>
                  <Fact label="Total" value={formatCurrency(money.totalPence)} />
                  <Fact label="Paid" value={formatCurrency(money.hirePaidPence)} />
                  <Fact label="Outstanding" value={formatCurrency(money.outstandingPence)} />
                  {money.securityDepositPence > 0 ? (
                    <Fact
                      label="Security deposit"
                      value={`${formatCurrency(money.securityDepositPence)} · refundable`}
                    />
                  ) : null}
                </>
              ) : null}
            </dl>

            {booking.roomNotHeld ? (
              <Callout tone="warning" icon={<Info className="h-4 w-4" aria-hidden />}>
                Nothing is held yet. The room is <strong>not held</strong> for you and the date
                stays open to other bookings until the club confirms one with you.
              </Callout>
            ) : null}

            <Callout icon={<Info className="h-4 w-4" aria-hidden />} title="What you agreed">
              {booking.termsSummary}
            </Callout>
          </div>
        ) : null}

        {current === "pay" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{booking.action.why}</p>
            <PaymentRail
              bookingId={booking.id}
              steps={booking.rail}
              sumupEnabled={sumupEnabled}
              showNotNeeded
            />
            {payInFull ? (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-list font-semibold">Rather pay it all now?</p>
                <p className="mb-2 text-2xs text-muted-foreground">
                  The deposit and the balance together. Any refundable security deposit is paid on
                  its own chip above.
                </p>
                <PayButton
                  bookingId={booking.id}
                  amountPence={money.outstandingPence}
                  label="Pay in full"
                  variant="outline"
                  purpose="balance"
                  sumupEnabled={sumupEnabled}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {current === "accept" ? (
          <div className="space-y-3">
            <p className="text-sm">
              {money.totalPence > 0
                ? `The club has quoted ${formatCurrency(money.totalPence)} for this booking.`
                : "The club has sent you a quote for this booking."}
            </p>
            <Callout tone="warning" icon={<Info className="h-4 w-4" aria-hidden />}>
              The date is <strong>not held</strong> by a quote. To go ahead, accept it below: the
              booking is then confirmed subject to the deposit, and you can pay the deposit straight
              away. {booking.termsSummary}
            </Callout>
            {money.totalPence > 0 ? (
              <AcceptQuoteButton bookingId={booking.id} totalPence={money.totalPence} />
            ) : (
              <p className="text-xs text-muted-foreground">
                The quote has no price on it yet — please contact the club.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-list font-medium">{value}</dd>
    </div>
  );
}
