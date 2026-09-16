/**
 * `/book` — the calendar, the sheet a free day opens, and the review that
 * sends it.
 *
 * The calendar case renders the real `BookFlow`, so the pinned status bar,
 * the month grid and the legend are photographed as they ship. The sheet
 * cases open over it: one by pressing a free day the way a visitor would
 * (the harness cannot press, so the fixture does), and one by rendering
 * `BookSheet` straight with a draft already filled in, because a review page
 * with nothing on it is not the review page worth looking at.
 *
 * A Sheet is portalled to <body>, so the harness's assertions — which are
 * scoped to #root — do not reach inside it. Those cases are here for the
 * pictures and for the console-error check.
 */

import { useEffect } from "react";

import { BookFlow, type BookedSlot } from "@/app/book/book-calendar";
import { BookSheet, EMPTY_DRAFT, type BookRoom, type BookingDraft } from "@/app/book/book-sheet";

import type { Fixture } from "./contract";

const noop = () => {};

/** The first free day of the month, pressed on the first paint. */
function PressFreeDay() {
  useEffect(() => {
    document.querySelector<HTMLButtonElement>("[data-day]:not([disabled])")?.click();
  }, []);
  return null;
}

const ROOM: BookRoom = {
  id: "room-1",
  name: "The Function Room",
  description: "Our main room, with its own bar and a dance floor.",
  capacity: 120,
  price_pence_per_hour: null,
  price_pence_half_day: null,
  price_pence_full_day: null,
  standard_price_pence: 15000,
  standard_hours: 4.5,
  extra_hour_pence: 5000,
  extras: [
    { id: "x1", name: "Bar staff", type: "binary", price_pence: 5000, active: true, options: [] },
    {
      id: "x2",
      name: "Buffet",
      type: "choice",
      price_pence: 0,
      active: true,
      options: [
        { label: "None", price_pence: 0 },
        { label: "Cold buffet", price_pence: 8000 },
        { label: "Hot buffet", price_pence: 12000 },
      ],
    },
  ],
};

/** Two evenings already taken this month, so the amber and the pips are drawn. */
function takenSlots(): BookedSlot[] {
  const now = new Date();
  const day = (n: number) =>
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
  return [
    { resource_id: ROOM.id, date: day(20), start_time: "19:00", end_time: "23:00" },
    { resource_id: ROOM.id, date: day(21), start_time: "09:00", end_time: "23:00" },
  ];
}

const FILLED: BookingDraft = {
  ...EMPTY_DRAFT,
  bookerFirstName: "Leanne",
  bookerLastName: "Minto",
  bookerEmail: "leanne@example.com",
  bookerPhone: "07700 900123",
  occasionType: "Birthday",
  birthdayAge: "50",
  estimatedGuests: "80",
  extras: { x1: true, x2: "Hot buffet" },
  connection: "family",
  childName: "Alex Minto",
  childTeam: "U12 Lions",
  intent: "book",
};

function Page({ children }: { children?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-40 h-14 border-b bg-card">
        <div className="mx-auto flex h-full max-w-3xl items-center justify-between gap-3 px-4">
          <span className="truncate text-row font-semibold">Function room hire</span>
          <span className="touch inline-flex items-center px-2 text-sm font-medium text-muted-foreground">
            Your bookings
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4 lg:py-6">
        <p className="text-sm text-muted-foreground">
          Our function rooms are available to hire for private events, parties, meetings and
          celebrations.
        </p>
        {children}
      </main>
    </div>
  );
}

const fixture: Fixture = {
  cases: {
    /** The page as it opens: the running answer, the month, the legend. */
    calendar: () => (
      <Page>
        <BookFlow rooms={[ROOM]} bookedSlots={takenSlots()} teamNames={["U12 Lions", "Vets"]} memberDiscountPence={5000} />
      </Page>
    ),

    /** A free day pressed — the calendar stays, the sheet comes up over it. */
    sheetOnFreeDay: () => (
      <>
        <Page>
          <BookFlow rooms={[ROOM]} bookedSlots={takenSlots()} teamNames={["U12 Lions", "Vets"]} memberDiscountPence={5000} />
        </Page>
        <PressFreeDay />
      </>
    ),

    /** The last mode: the cost, the either/or, and the one button that sends it. */
    review: () => (
      <>
        <Page />
        <BookSheet
          room={ROOM}
          date="2026-11-21"
          dateLabel="Saturday, 21 November 2026"
          draft={FILLED}
          set={noop}
          mode="review"
          onMode={noop}
          onClose={noop}
          teamNames={["U12 Lions", "Vets"]}
          memberDiscountPence={5000}
        />
      </>
    ),
  },
};

export default fixture;
