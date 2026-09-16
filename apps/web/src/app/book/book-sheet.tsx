"use client";

/**
 * The booking form, as a sheet over the calendar (P8.9).
 *
 * It used to be a 430-line `<Card>` that appeared BELOW the calendar and
 * scrolled itself into view, which on a phone meant the date you had just
 * chosen went off the top of the screen and stayed there for the rest of the
 * form. Now it is a sheet: the calendar stays where it is, the sheet comes up
 * over it, and closing it puts you back on the month you were looking at.
 *
 * Four modes rather than one long scroll — details, extras, who you are,
 * review — because the thing being asked for changes completely between them
 * and a hirer on a phone can only see one of them at a time anyway. The
 * extras mode is only offered when the room has extras.
 *
 * `submitBooking` is called from the review mode with exactly the FormData
 * the old form built, and both of its answers are handled the way they were:
 * a `url` (the booking went to a room the club asks to be paid for up front)
 * is pushed, and an `id` goes to `/book/[id]`.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { poundsLabel, type ExtraConfig } from "@/lib/booking-extras";
import { roomHirePence } from "@/lib/room-pricing";
import { formatCurrency } from "@/lib/utils";

import { submitBooking } from "./actions";

export type BookRoom = {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  price_pence_per_hour: number | null;
  price_pence_half_day: number | null;
  price_pence_full_day: number | null;
  standard_price_pence: number | null;
  standard_hours: number | null;
  extra_hour_pence: number | null;
  /** The room's optional extras (Adam, 2026-09-03, reinstated). */
  extras: ExtraConfig[];
};

/**
 * Everything the visitor has typed, in one object. It lives in the shell
 * above the calendar rather than in the sheet, so closing the sheet to look
 * at another date does not throw the form away.
 */
export type BookingDraft = {
  startTime: string;
  endTime: string;
  bookerFirstName: string;
  bookerLastName: string;
  bookerEmail: string;
  bookerPhone: string;
  occasionType: string;
  occasionOther: string;
  birthdayAge: string;
  estimatedGuests: string;
  /** Chosen extras keyed by the extra's id: an option label, or true for a yes. */
  extras: Record<string, string | boolean>;
  notes: string;
  connection: "none" | "family" | "player" | "social";
  childName: string;
  childTeam: string;
  playerTeam: string;
  memberNumber: string;
  /** "book" asks for the date; "enquiry" holds NOTHING and says so everywhere. */
  intent: "book" | "enquiry";
};

export const EMPTY_DRAFT: BookingDraft = {
  startTime: "19:00",
  endTime: "23:00",
  bookerFirstName: "",
  bookerLastName: "",
  bookerEmail: "",
  bookerPhone: "",
  occasionType: "",
  occasionOther: "",
  birthdayAge: "",
  estimatedGuests: "",
  extras: {},
  notes: "",
  connection: "none",
  childName: "",
  childTeam: "",
  playerTeam: "",
  memberNumber: "",
  intent: "enquiry",
};

/**
 * The running cost, which the status bar above the calendar shows and the
 * review mode breaks down. One set of maths for the estimate, the stored
 * amount and the card (`lib/room-pricing`): £150 to 4½ hours, £25 per started
 * half hour after.
 */
export function draftEstimate(room: BookRoom | undefined, draft: BookingDraft) {
  if (!room || !draft.startTime || !draft.endTime) return { hirePence: 0, extrasPence: 0, totalPence: 0 };
  const hirePence = roomHirePence(room, draft.startTime, draft.endTime) ?? 0;
  const extrasPence = room.extras.reduce((sum, extra) => {
    const value = draft.extras[extra.id];
    if (extra.type === "binary") return value === true ? sum + extra.price_pence : sum;
    const option = extra.options.find((o) => o.label === value);
    return option ? sum + option.price_pence : sum;
  }, 0);
  return { hirePence, extrasPence, totalPence: hirePence + extrasPence };
}

export type BookMode = "details" | "extras" | "who" | "review";

const MODE_LABEL: Record<BookMode, string> = {
  details: "Details",
  extras: "Extras",
  who: "Who you are",
  review: "Review",
};

export function bookModes(room: BookRoom | undefined): BookMode[] {
  return room && room.extras.length > 0
    ? ["details", "extras", "who", "review"]
    : ["details", "who", "review"];
}

/**
 * What is still missing, and which mode it is in. The old form leaned on
 * native `required`, which cannot work across a wizard — a browser refuses to
 * report a field it cannot scroll to. Saying it in words on the review page
 * is clearer anyway, and the server validates all of it again regardless.
 */
export function missingFrom(draft: BookingDraft): { mode: BookMode; label: string }[] {
  const gaps: { mode: BookMode; label: string }[] = [];
  const need = (mode: BookMode, value: string, label: string) => {
    if (!value.trim()) gaps.push({ mode, label });
  };
  need("details", draft.startTime, "a start time");
  need("details", draft.endTime, "an end time");
  if (draft.occasionType === "Other") need("details", draft.occasionOther, "what the occasion is");
  if (draft.occasionType === "Birthday") need("details", draft.birthdayAge, "the age being celebrated");
  need("who", draft.bookerFirstName, "your first name");
  need("who", draft.bookerLastName, "your last name");
  need("who", draft.bookerEmail, "your email address");
  need("who", draft.bookerPhone, "your mobile number");
  if (draft.connection === "player") need("who", draft.playerTeam, "your team");
  if (draft.connection === "family") {
    need("who", draft.childName, "your child's name");
    need("who", draft.childTeam, "their team");
  }
  return gaps;
}

export function BookSheet({
  room,
  date,
  dateLabel,
  draft,
  set,
  mode,
  onMode,
  onClose,
  teamNames,
  memberDiscountPence,
}: {
  room: BookRoom | undefined;
  /** The chosen day, as `YYYY-MM-DD`. */
  date: string;
  dateLabel: string;
  draft: BookingDraft;
  set: (patch: Partial<BookingDraft>) => void;
  mode: BookMode;
  onMode: (mode: BookMode) => void;
  onClose: () => void;
  teamNames: string[];
  memberDiscountPence: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const modes = bookModes(room);
  const current = modes.includes(mode) ? mode : "details";
  const index = modes.indexOf(current);
  const money = draftEstimate(room, draft);
  const gaps = missingFrom(draft);
  const underage =
    draft.occasionType === "Birthday" &&
    Number(draft.birthdayAge) > 0 &&
    Number(draft.birthdayAge) < 18;

  async function send() {
    setError(null);
    setLoading(true);
    const fd = new FormData();
    fd.set("intent", draft.intent);
    fd.set("room_id", room?.id ?? "");
    fd.set("date", date);
    fd.set("start_time", draft.startTime);
    fd.set("end_time", draft.endTime);
    fd.set("booker_first_name", draft.bookerFirstName);
    fd.set("booker_last_name", draft.bookerLastName);
    fd.set("booker_email", draft.bookerEmail);
    fd.set("booker_phone", draft.bookerPhone);
    // The club's party rule (Adam, 2026-09-03, reinstated): no under-18
    // parties at all; an 18th is welcome and carries a £200 security deposit,
    // which the page has already said. The server refuses under-18s again —
    // this just saves the round trip.
    if (draft.occasionType === "Birthday") {
      if (underage) {
        setError("Sorry — we don't take bookings for under-18 birthday parties.");
        setLoading(false);
        return;
      }
      if (draft.birthdayAge.trim()) fd.set("birthday_age", draft.birthdayAge.trim());
    }
    const occasionFinal =
      draft.occasionType === "Other"
        ? draft.occasionOther.trim()
        : draft.occasionType === "Birthday" && draft.birthdayAge.trim()
          ? `Birthday (age ${draft.birthdayAge.trim()})`
          : draft.occasionType;
    fd.set("occasion", occasionFinal);
    if (draft.estimatedGuests) fd.set("estimated_guests", draft.estimatedGuests);
    fd.set("notes", draft.notes);
    if (Object.keys(draft.extras).length > 0) fd.set("extras_selected", JSON.stringify(draft.extras));
    if (draft.connection !== "none") {
      fd.set("club_connection", draft.connection);
      if (draft.connection === "family") {
        fd.set("child_name", draft.childName);
        fd.set("child_team", draft.childTeam);
      }
      if (draft.connection === "player") fd.set("player_team", draft.playerTeam);
      if (draft.connection === "social") fd.set("member_number", draft.memberNumber);
    }

    try {
      const result = await submitBooking(fd);
      if ("error" in result) {
        setError(result.error);
        setLoading(false);
        return;
      }
      if ("url" in result) {
        router.push(result.url);
        return;
      }
      router.push(`/book/${result.id}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  const footer =
    current === "review" ? (
      <Button
        type="button"
        size="touch"
        className="w-full"
        disabled={loading || gaps.length > 0 || underage}
        onClick={send}
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            {draft.intent === "enquiry" ? "Sending enquiry…" : "Submitting request…"}
          </>
        ) : draft.intent === "enquiry" ? (
          "Send an enquiry — room not held"
        ) : (
          "Request this date"
        )}
      </Button>
    ) : (
      <div className="flex gap-2">
        {index > 0 ? (
          <Button type="button" variant="outline" size="touch" className="flex-1" onClick={() => onMode(modes[index - 1]!)}>
            Back
          </Button>
        ) : null}
        <Button type="button" size="touch" className="flex-1" onClick={() => onMode(modes[index + 1]!)}>
          Next
        </Button>
      </div>
    );

  return (
    <Sheet
      open
      onClose={onClose}
      title={dateLabel}
      subtitle={`${room?.name ?? "Function room"} · ${draft.startTime}–${draft.endTime}${money.totalPence > 0 ? ` · estimated ${formatCurrency(money.totalPence)}` : ""}`}
      footer={footer}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {modes.map((each) => (
            <ToggleChip key={each} on={each === current} size="sm" onClick={() => onMode(each)}>
              {MODE_LABEL[each]}
            </ToggleChip>
          ))}
        </div>

        {current === "details" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="start_time">Start time *</Label>
              <Input className="touch" id="start_time" type="time" value={draft.startTime} onChange={(e) => set({ startTime: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end_time">End time *</Label>
              <Input className="touch" id="end_time" type="time" value={draft.endTime} onChange={(e) => set({ endTime: e.target.value })} />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="occasion_type">Occasion</Label>
              <Select className="touch"
                id="occasion_type"
                value={draft.occasionType}
                onChange={(e) => set({ occasionType: e.target.value, occasionOther: "", birthdayAge: "" })}
              >
                <option value="">Select occasion…</option>
                <option value="Birthday">Birthday</option>
                <option value="Anniversary">Anniversary</option>
                <option value="Private party">Private party</option>
                <option value="Corporate / Business meeting">Corporate / Business meeting</option>
                <option value="Wake / Funeral reception">Wake / Funeral reception</option>
                <option value="Christening / Naming ceremony">Christening / Naming ceremony</option>
                <option value="Charity event">Charity event</option>
                <option value="Other">Other</option>
              </Select>
            </div>

            {draft.occasionType === "Birthday" ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="birthday_age">Age being celebrated *</Label>
                <Input
                  className="touch"
                  id="birthday_age"
                  type="number"
                  min="1"
                  value={draft.birthdayAge}
                  onChange={(e) => set({ birthdayAge: e.target.value })}
                  placeholder="e.g. 50"
                />
                {underage ? (
                  <Callout tone="danger">
                    Sorry — we don&apos;t take bookings for under-18 birthday parties.
                  </Callout>
                ) : Number(draft.birthdayAge) === 18 ? (
                  <Callout tone="warning">
                    18th birthday parties are welcome — please note they carry a{" "}
                    <strong>£200 refundable security deposit</strong>, payable before the event and
                    returned after it if all is well.
                  </Callout>
                ) : null}
              </div>
            ) : null}

            {draft.occasionType === "Other" ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="occasion_other">Please describe *</Label>
                <Input
                  className="touch"
                  id="occasion_other"
                  value={draft.occasionOther}
                  onChange={(e) => set({ occasionOther: e.target.value })}
                  placeholder="Describe your occasion…"
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="estimated_guests">Estimated guests</Label>
              <Input
                className="touch"
                id="estimated_guests"
                type="number"
                min="1"
                value={draft.estimatedGuests}
                onChange={(e) => set({ estimatedGuests: e.target.value })}
                placeholder="Approx. number"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">Additional notes</Label>
              <textarea
                id="notes"
                value={draft.notes}
                onChange={(e) => set({ notes: e.target.value })}
                placeholder="Any requirements or questions…"
                rows={3}
                className="touch flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
        ) : null}

        {current === "extras" && room ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {room.extras.map((extra) =>
                extra.type === "binary" ? (
                  <label key={extra.id} className="touch flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.extras[extra.id] === true}
                      onChange={(e) => set({ extras: { ...draft.extras, [extra.id]: e.target.checked } })}
                      className="touch h-4 w-4 flex-none accent-primary"
                    />
                    <span className="min-w-0 flex-1">{extra.name}</span>
                    <span className="flex-none text-muted-foreground">{poundsLabel(extra.price_pence)}</span>
                  </label>
                ) : (
                  <div key={extra.id} className="space-y-1.5">
                    <Label htmlFor={`extra-${extra.id}`}>{extra.name}</Label>
                    <Select className="touch"
                      id={`extra-${extra.id}`}
                      value={typeof draft.extras[extra.id] === "string" ? (draft.extras[extra.id] as string) : ""}
                      onChange={(e) => set({ extras: { ...draft.extras, [extra.id]: e.target.value } })}
                    >
                      {extra.options.map((option) => (
                        <option key={option.label} value={option.label}>
                          {option.label}
                          {option.price_pence > 0 ? ` — ${poundsLabel(option.price_pence)}` : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                ),
              )}
            </div>
            {money.extrasPence > 0 ? (
              <p className="text-sm text-muted-foreground">
                Extras: <span className="font-medium text-foreground">{formatCurrency(money.extrasPence)}</span> ·
                Estimated total:{" "}
                <span className="font-medium text-foreground">{formatCurrency(money.totalPence)}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        {current === "who" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="booker_first_name">First name *</Label>
              <Input className="touch" id="booker_first_name" value={draft.bookerFirstName} onChange={(e) => set({ bookerFirstName: e.target.value })} placeholder="First name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booker_last_name">Last name *</Label>
              <Input className="touch" id="booker_last_name" value={draft.bookerLastName} onChange={(e) => set({ bookerLastName: e.target.value })} placeholder="Last name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booker_email">Email address *</Label>
              <Input className="touch" id="booker_email" type="email" value={draft.bookerEmail} onChange={(e) => set({ bookerEmail: e.target.value })} placeholder="you@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booker_phone">Mobile number *</Label>
              <Input className="touch" id="booker_phone" type="tel" value={draft.bookerPhone} onChange={(e) => set({ bookerPhone: e.target.value })} placeholder="e.g. 07700 900000" />
            </div>

            {/* The member-discount claim (Adam, 2026-09-03). Three ways in, all
                claims, none priced automatically: the desk checks them against
                the club's records and records the discount at confirmation. */}
            <fieldset className="space-y-3 rounded-lg border p-4 sm:col-span-2">
              <legend className="px-1 text-sm font-medium">Club connection — member discount</legend>
              <p className="text-xs text-muted-foreground">
                Players, parents of club players and social members all get{" "}
                {memberDiscountPence > 0
                  ? `£${(memberDiscountPence / 100).toFixed(memberDiscountPence % 100 === 0 ? 0 : 2)} off room hire`
                  : "a member discount"}
                . Tell us your connection and we&apos;ll check it and apply it to your price.
              </p>
              <Select className="touch"
                value={draft.connection}
                onChange={(e) => set({ connection: e.target.value as BookingDraft["connection"] })}
                aria-label="Club connection"
              >
                <option value="none">No club connection</option>
                <option value="player">I play for the club</option>
                <option value="family">A child in my family plays for the club</option>
                <option value="social">I&apos;m a social member</option>
              </Select>

              {draft.connection === "player" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="player_team">Your team *</Label>
                  <Input className="touch" id="player_team" value={draft.playerTeam} onChange={(e) => set({ playerTeam: e.target.value })} placeholder="e.g. Vets" list="club-team-names" />
                </div>
              ) : null}

              {draft.connection === "family" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="child_name">Child&apos;s name *</Label>
                    <Input className="touch" id="child_name" value={draft.childName} onChange={(e) => set({ childName: e.target.value })} placeholder="e.g. Alex Smith" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="child_team">Their team *</Label>
                    <Input className="touch" id="child_team" value={draft.childTeam} onChange={(e) => set({ childTeam: e.target.value })} placeholder="e.g. U12 Lions" list="club-team-names" />
                  </div>
                </div>
              ) : null}

              {draft.connection === "social" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="member_number">Membership number (if you have it)</Label>
                  <Input className="touch" id="member_number" value={draft.memberNumber} onChange={(e) => set({ memberNumber: e.target.value })} placeholder="Optional" />
                </div>
              ) : null}

              <datalist id="club-team-names">
                {teamNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </fieldset>
          </div>
        ) : null}

        {current === "review" ? (
          <div className="space-y-4">
            {/* The estimated cost, always on show (Adam, 2026-09-03: "Build in
                the estimated costs") — the same tier maths the server re-runs,
                plus the extras, minus nothing: the member discount is applied
                by a person after the claim is checked, and the note says so. */}
            {money.hirePence > 0 ? (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Room hire ({draft.startTime}–{draft.endTime})</span>
                  <span className="tabular-nums">{formatCurrency(money.hirePence)}</span>
                </div>
                {money.extrasPence > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Extras</span>
                    <span className="tabular-nums">{formatCurrency(money.extrasPence)}</span>
                  </div>
                ) : null}
                <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                  <span>Estimated total</span>
                  <span className="tabular-nums">{formatCurrency(money.totalPence)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  An estimate, confirmed with your booking.
                  {draft.connection !== "none"
                    ? " Your member discount is applied once we've checked your club connection."
                    : ""}
                </p>
              </div>
            ) : null}

            {/* The choice comes BEFORE the button, as two equal cards (Adam,
                2026-09-03: an orange button with a white afterthought
                underneath "is not clear enough"). Radio semantics so a
                keyboard and a screen reader get a real either/or, and the one
                submit button in the footer says which of the two it will do. */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">What would you like to send?</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label
                  className={
                    "flex cursor-pointer flex-col gap-1 rounded-lg border-2 p-4 transition " +
                    (draft.intent === "enquiry"
                      ? "border-warning bg-warning-tint"
                      : "border-input bg-card hover:border-muted-foreground/40")
                  }
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="send_as"
                      checked={draft.intent === "enquiry"}
                      onChange={() => set({ intent: "enquiry" })}
                      className="touch h-4 w-4 flex-none accent-primary"
                    />
                    <span className="text-sm font-semibold">Enquiry only</span>
                  </span>
                  <span className={"text-xs " + (draft.intent === "enquiry" ? "text-warning" : "text-muted-foreground")}>
                    Just a question about this date — the room is <strong>not held for you</strong>,
                    and the date stays open to other bookings until you confirm one with us.
                  </span>
                </label>
                <label
                  className={
                    "flex cursor-pointer flex-col gap-1 rounded-lg border-2 p-4 transition " +
                    (draft.intent === "book"
                      ? "border-primary bg-primary/5"
                      : "border-input bg-card hover:border-muted-foreground/40")
                  }
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="send_as"
                      checked={draft.intent === "book"}
                      onChange={() => set({ intent: "book" })}
                      className="touch h-4 w-4 flex-none accent-primary"
                    />
                    <span className="text-sm font-semibold">Booking request</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    We&apos;ll confirm availability and the total with you. The date is secured once
                    it&apos;s confirmed and the non-refundable deposit (half the total cost, up to
                    £100) is paid; the balance, plus any security deposit, is due two weeks before.
                  </span>
                </label>
              </div>
            </fieldset>

            {gaps.length > 0 ? (
              <Callout tone="warning" title="Still to fill in">
                {gaps.map((gap) => gap.label).join(", ")} —{" "}
                <button type="button" className="underline" onClick={() => onMode(gaps[0]!.mode)}>
                  go back and add {gaps.length === 1 ? "it" : "them"}
                </button>
                .
              </Callout>
            ) : null}

            {error ? <Callout tone="danger">{error}</Callout> : null}

            <p className="text-xs text-muted-foreground">
              {draft.intent === "enquiry"
                ? "We'll reply with availability and prices. Nothing is booked and nothing is held."
                : "Your request will be reviewed by our team. We'll be in touch to confirm availability and the total; a non-refundable deposit of half the total cost (up to £100) then secures the room, and the balance plus any security deposit is due two weeks before your event."}
            </p>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
