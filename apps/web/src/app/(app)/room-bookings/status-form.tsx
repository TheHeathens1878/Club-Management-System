"use client";

/**
 * The four things the desk does to a booking's status, as four forms.
 *
 * This file used to be one `StatusForm` that rendered all of them stacked in a
 * sidebar, each hidden behind a local `confirm === "quote" | "chaser" | "final"
 * | "confirm" | "cancel"` flag — a state machine in a component, whose state
 * was lost the moment a server action refreshed the page underneath it, and
 * which showed the desk five buttons when it wanted one. P8.1b moved that
 * machine into `BookingSheet`'s `mode`, which lives in the URL (`?sheet=`), so
 * it survives the refresh and can be linked to from the desk list as well.
 *
 * What is left here is what was always the real content: four forms, each
 * owning nothing but its own fields, each calling the same server action with
 * the same arguments it always did, and each telling the sheet it is done.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Loader2, Square, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { formatCurrency } from "@/lib/utils";

import { confirmBooking, cancelBooking, sendChaser, sendFinalChaser, sendQuote } from "./actions";
import { bookingDepositPence, type DepositRule } from "@/lib/hire-terms";

function whenSent(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Every form ends the same way: refresh what the page shows, then get out. */
type Done = { onDone: () => void };

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase text-muted-foreground">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Actions({
  busy,
  label,
  onRun,
  onCancel,
  disabled = false,
  variant = "default",
}: {
  busy: boolean;
  label: string;
  onRun: () => void;
  onCancel: () => void;
  disabled?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <div className="flex gap-2">
      <Button size="touch" variant={variant} onClick={onRun} disabled={busy || disabled} className="flex-1">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : label}
      </Button>
      <Button size="touch" variant="outline" onClick={onCancel} disabled={busy}>
        Back
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quote — prices the ask WITHOUT holding the room
// ---------------------------------------------------------------------------

/**
 * A quote prices the ask but does not take the date: the status becomes
 * `quoted`, which the no-overlap rule ignores exactly as it ignores `enquiry`.
 * Confirming later is the act that takes it.
 */
export function QuoteForm({
  bookingId,
  currentStatus,
  currentTotalPence = null,
  onDone,
}: {
  bookingId: string;
  currentStatus: string;
  currentTotalPence?: number | null;
} & Done) {
  const router = useRouter();
  const [pounds, setPounds] = useState(currentTotalPence ? String(currentTotalPence / 100) : "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setBusy(true);
    const result = await sendQuote(bookingId, {
      totalPence: pounds ? Math.round(Number(pounds) * 100) : null,
      message,
    });
    setBusy(false);
    if (result.error) setError(result.error);
    else {
      router.refresh();
      onDone();
    }
  }

  return (
    <div className="space-y-3">
      {currentStatus === "cancelled" && (
        <Callout tone="info">
          Reopens it as a quote — the room is not held until it is confirmed again, and the old deposit
          deadline is cleared.
        </Callout>
      )}
      <Field label="Quoted total (£)">
        <Input
          className="touch"
          type="number"
          min="0"
          step="0.01"
          value={pounds}
          onChange={(e) => setPounds(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
      </Field>
      <Field label="Message to include (optional)">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Anything you want to say alongside the price — goes in the quote email, under the price."
          className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        The booker is emailed the price with a room-not-held note. If nothing is confirmed within three
        days, one follow-up goes out automatically.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Actions busy={busy} label="Send quote" onRun={run} onCancel={onDone} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chase — ask again, then the one-time final offer
// ---------------------------------------------------------------------------

/**
 * Two chasers (Adam, 2026-09-11). The first only asks and can go again; the
 * second halves the room hire, amends the quote to match, and can only be sent
 * once. Neither holds the room.
 */
export function ChaseForm({
  bookingId,
  currentStatus,
  currentTotalPence = null,
  chaserSentAt = null,
  finalChaserSentAt = null,
  finalChaserDiscountPence = null,
  onDone,
}: {
  bookingId: string;
  currentStatus: string;
  currentTotalPence?: number | null;
  chaserSentAt?: string | null;
  finalChaserSentAt?: string | null;
  finalChaserDiscountPence?: number | null;
} & Done) {
  const router = useRouter();
  const [busy, setBusy] = useState<"chaser" | "final" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const halfHire = currentTotalPence ? Math.round(currentTotalPence / 2) : 0;

  async function run(which: "chaser" | "final") {
    setError(null);
    setBusy(which);
    const result = which === "chaser" ? await sendChaser(bookingId) : await sendFinalChaser(bookingId);
    setBusy(null);
    if (result.error) setError(result.error);
    else {
      router.refresh();
      onDone();
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm">
          Email {currentStatus === "quoted" ? "the booker" : "the enquirer"} asking whether they still
          want the room{currentTotalPence ? ", repeating the quoted price" : ""}. Nothing is held.
        </p>
        <Button size="touch" onClick={() => void run("chaser")} disabled={busy !== null} className="w-full">
          {busy === "chaser" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : chaserSentAt ? (
            "Send chaser again"
          ) : (
            "Send chaser"
          )}
        </Button>
      </div>

      {!finalChaserSentAt && (
        <div className="space-y-2 rounded-lg border border-warning/25 bg-warning-tint p-3">
          <p className="text-sm font-medium text-warning">Final offer — half off the room hire</p>
          <p className="text-xs text-warning">
            The quote is amended to the new price before the email goes, the booking becomes a quote, and
            this cannot be sent twice.
            {currentTotalPence
              ? ` The price is ${formatCurrency(currentTotalPence)} now; the offer will be about ${formatCurrency(halfHire)} off (exactly half the room hire — extras stay at their price).`
              : " Send a quote first: there is no price to halve."}
          </p>
          <Button
            size="touch"
            variant="outline"
            onClick={() => void run("final")}
            disabled={busy !== null || !currentTotalPence}
            className="w-full border-warning/40 text-warning hover:bg-warning-tint"
          >
            {busy === "final" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              "Amend quote & send final offer"
            )}
          </Button>
        </div>
      )}

      {(chaserSentAt || finalChaserSentAt) && (
        <p className="text-xs text-muted-foreground">
          {chaserSentAt ? `Chaser sent ${whenSent(chaserSentAt)}.` : ""}
          {chaserSentAt && finalChaserSentAt ? " " : ""}
          {finalChaserSentAt
            ? `Final offer sent ${whenSent(finalChaserSentAt)}${
                finalChaserDiscountPence ? ` — ${formatCurrency(finalChaserDiscountPence)} off, quote amended` : ""
              }.`
            : ""}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm — the act that takes the date, and sets the terms
// ---------------------------------------------------------------------------

/**
 * Confirming is what takes the slot, from an enquiry or a quote alike; the
 * constraint arbitrates any race. It is also the door for a booking that was
 * confirmed and never given its terms — no deposit deadline, so no confirmation
 * went out and no reminder will — and for that one it runs the whole thing from
 * today (Lyndsey, September 2026).
 */
export function ConfirmForm({
  bookingId,
  needsTerms = false,
  defaultDepositPence = 0,
  currentTotalPence = null,
  currentDepositPence = null,
  currentSecurityDepositPence = null,
  depositRuleLabel,
  depositRule = null,
  defaultSecurityDepositPence = 0,
  defaultMemberDiscountPence = null,
  isMember = false,
  memberLabel = null,
  onDone,
}: {
  bookingId: string;
  /** Confirmed already, but with no deadline on it: this sets them from today. */
  needsTerms?: boolean;
  defaultDepositPence?: number;
  currentTotalPence?: number | null;
  currentDepositPence?: number | null;
  /** The refundable security deposit the booking carries (an 18th birthday's £200). */
  currentSecurityDepositPence?: number | null;
  /** The deposit rule in words — "half the total cost, up to £100". */
  depositRuleLabel?: string;
  /** The rule itself, so the deposit box follows the total as it is typed. */
  depositRule?: DepositRule | null;
  /** The club's default security deposit (Adam, 2026-09-15: £100). */
  defaultSecurityDepositPence?: number;
  /** The club's configured discount — prefilled when a claim is on the booking. */
  defaultMemberDiscountPence?: number | null;
  /** The booker said they are a member; a discount needs the check, and the stamp. */
  isMember?: boolean;
  /** What they claimed — "Social · 00123" — so the desk knows what to check. */
  memberLabel?: string | null;
} & Done) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalPounds, setTotalPounds] = useState(currentTotalPence ? String(currentTotalPence / 100) : "");
  const [depositPounds, setDepositPounds] = useState(
    String((currentDepositPence ?? defaultDepositPence) / 100 || ""),
  );
  // Until the desk types a deposit of its own, the box follows the total by the
  // club's rule (half, up to £100) — a total typed at confirmation is the one
  // the rule should apply to, not the enquiry's estimate.
  const [depositTouched, setDepositTouched] = useState(currentDepositPence != null && currentDepositPence > 0);
  const [securityPounds, setSecurityPounds] = useState(
    currentSecurityDepositPence
      ? String(currentSecurityDepositPence / 100)
      : defaultSecurityDepositPence > 0
        ? String(defaultSecurityDepositPence / 100)
        : "",
  );
  const [discountPounds, setDiscountPounds] = useState(
    defaultMemberDiscountPence ? (defaultMemberDiscountPence / 100).toFixed(2) : "",
  );
  const [memberChecked, setMemberChecked] = useState(false);

  function onTotalChange(value: string) {
    setTotalPounds(value);
    if (depositTouched || !depositRule) return;
    const totalPence = value ? Math.round(Number(value) * 100) : 0;
    const suggested = bookingDepositPence({ total_pence: totalPence }, depositRule);
    setDepositPounds(suggested > 0 ? String(suggested / 100) : "");
  }

  async function run() {
    setError(null);
    const memberDiscountPence = discountPounds ? Math.round(Number(discountPounds) * 100) : null;
    if (memberDiscountPence != null && memberDiscountPence > 0 && !memberChecked) {
      setError("Tick to confirm you have checked their membership before applying a member discount.");
      return;
    }
    setBusy(true);
    const result = await confirmBooking(bookingId, {
      totalPence: totalPounds ? Math.round(Number(totalPounds) * 100) : null,
      depositPence: depositPounds ? Math.round(Number(depositPounds) * 100) : 0,
      memberDiscountPence,
      securityDepositPence: securityPounds ? Math.round(Number(securityPounds) * 100) : 0,
      memberChecked,
    });
    setBusy(false);
    if (result.error) setError(result.error);
    else {
      router.refresh();
      onDone();
    }
  }

  return (
    <div className="space-y-3">
      {needsTerms && (
        <Callout tone="warning" icon={<TriangleAlert className="h-4 w-4" aria-hidden />}>
          This booking is confirmed but has no payment terms — no deposit deadline, so no confirmation
          email went and no reminders will. Setting the price and terms sends the confirmation and starts
          the reminders from today.
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Total cost (£)">
          <Input
            className="touch"
            type="number"
            min="0"
            step="0.01"
            value={totalPounds}
            onChange={(e) => onTotalChange(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </Field>
        <Field
          label="Deposit (£) — non-refundable"
          hint={`Secures the room, paid first. Follows the total as ${depositRuleLabel ?? "the club's rule"} until you type your own.`}
        >
          <Input
            className="touch"
            type="number"
            min="0"
            step="0.01"
            value={depositPounds}
            onChange={(e) => {
              setDepositTouched(true);
              setDepositPounds(e.target.value);
            }}
            placeholder="0.00"
          />
        </Field>
      </div>

      <Field
        label="Refundable security deposit (£)"
        hint={`Held for the event and returned after it if all is well; due with the balance, two weeks before. £${(defaultSecurityDepositPence / 100).toFixed(0)} by default; an 18th birthday carries £200 from the form. Clear it for none.`}
      >
        <Input
          className="touch"
          type="number"
          min="0"
          step="0.01"
          value={securityPounds}
          onChange={(e) => setSecurityPounds(e.target.value)}
          placeholder="0.00"
        />
      </Field>

      <Field
        label="Member discount applied (£, optional)"
        hint={
          <>
            {isMember ? (
              <>
                They said they are a member{memberLabel ? <> ({memberLabel})</> : null}, so the club&apos;s
                discount is offered.{" "}
              </>
            ) : (
              <>Check any claimed club child on the booking first. </>
            )}
            The total above should already include the discount — this records how much of it there was.
          </>
        }
      >
        <Input
          className="touch"
          type="number"
          min="0"
          step="0.01"
          value={discountPounds}
          onChange={(e) => setDiscountPounds(e.target.value)}
          placeholder="0.00"
        />
      </Field>

      {(isMember || Number(discountPounds) > 0) && (
        // The tick that stamps `member_checked_at`. It was a 16px checkbox,
        // which is not a tap target on a phone; it is the shared chip now, and
        // it says out loud which way it is set.
        <div className="space-y-1">
          <ToggleChip
            on={memberChecked}
            onClick={() => {
              setMemberChecked(!memberChecked);
              setError(null);
            }}
            className="w-full justify-start"
          >
            {memberChecked ? (
              <CheckSquare className="h-4 w-4" aria-hidden />
            ) : (
              <Square className="h-4 w-4" aria-hidden />
            )}
            I have checked their membership
          </ToggleChip>
          <p className="text-xs text-muted-foreground">
            Stamped on the booking with your name and today&apos;s date; required for a discount.
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        The booker is emailed a confirmation with the total and the terms — the non-refundable deposit
        that secures the room, then the balance plus any security deposit two weeks before — and a portal
        link to pay each.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Actions busy={busy} label="Confirm & notify booker" onRun={run} onCancel={onDone} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export function CancelForm({ bookingId, onDone }: { bookingId: string } & Done) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    if (!reason.trim()) {
      setError("Please enter a cancellation reason.");
      return;
    }
    setBusy(true);
    const result = await cancelBooking(bookingId, reason);
    setBusy(false);
    if (result.error) setError(result.error);
    else {
      router.refresh();
      onDone();
    }
  }

  return (
    <div className="space-y-3">
      <Callout tone="danger" icon={<TriangleAlert className="h-4 w-4" aria-hidden />}>
        This cancellation reason will be emailed to the booker.
      </Callout>
      <Field label="Cancellation reason *">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          autoFocus
          placeholder="e.g. The room is unavailable due to a prior commitment. We apologise for any inconvenience…"
          className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Actions
        busy={busy}
        label="Send cancellation"
        variant="destructive"
        disabled={!reason.trim()}
        onRun={run}
        onCancel={onDone}
      />
    </div>
  );
}
