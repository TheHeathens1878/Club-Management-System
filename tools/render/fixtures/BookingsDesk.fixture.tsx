/**
 * The function-room desk (P8.2).
 *
 * The cases are the four claims this PR makes: a club-sized month reads at a
 * desk without the page moving sideways; the same month on a phone is a WEEK
 * with day chips (the `min-w-[640px]` regression, which is why this case
 * matters at 390 far more than at 1440); a press on a booking opens the sheet
 * where it sits; and the list still has its ticks and its bulk bar.
 *
 * The bookings are generated into the month the harness runs in, because the
 * calendar opens on today — a fixed November would photograph an empty grid.
 *
 * `BookingsDesk` pulls in `BookingSheet`, the list's bulk actions and the
 * export buttons, all of which import `"use server"` modules; the bundler
 * swaps those for the no-op shim, so every control renders and nothing writes.
 * What cannot be photographed here: a server action's spinner, and the print
 * overlay (it is behind `window.print()`).
 */

import { useEffect } from "react";

import { BookingsDesk } from "@/app/(app)/room-bookings/bookings-desk";
import { deskSummary, type DeskBooking } from "@/app/(app)/room-bookings/desk-shared";
import { bookingMoney } from "@/lib/booking-next-action";
import type { BookingListItem } from "@/lib/booking-types";

import type { Fixture } from "./contract";

const ROOMS = [
  { id: "room-1", name: "Function Room" },
  { id: "room-2", name: "Lounge" },
];

const ROOM_NAME: Record<string, string> = Object.fromEntries(ROOMS.map((r) => [r.id, r.name]));

const NOW = new Date();
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}`;

function dateOn(day: number): string {
  return `${YM}-${String(day).padStart(2, "0")}`;
}

type Seed = {
  day: number;
  name: string;
  status: BookingListItem["status"];
  room?: string;
  occasion?: string;
  kind?: BookingListItem["kind"];
  total?: number;
  paid?: number;
  key?: DeskBooking["next"]["key"];
  mode?: DeskBooking["next"]["mode"];
  createdDay?: number;
};

/** A club month: two dozen hires, in every state the desk meets them in. */
const SEEDS: Seed[] = [
  { day: 2, name: "Priya Raval", status: "confirmed", occasion: "Christening", total: 34000, paid: 34000, key: "paid-in-full", mode: "email" },
  { day: 3, name: "Sale Rugby Club", status: "confirmed", occasion: "Awards night", total: 52000, paid: 10000, key: "await-balance", mode: "chase" },
  { day: 4, name: "Jane Metcalfe", status: "enquiry", occasion: "60th birthday", key: "send-quote", mode: "quote", createdDay: 1 },
  { day: 5, name: "Blocked", status: "confirmed", kind: "block" },
  { day: 6, name: "Tom Ashworth", status: "quoted", occasion: "Wake", total: 28000, key: "send-chaser", mode: "chase", createdDay: 2 },
  { day: 7, name: "Heathside WI", status: "confirmed", room: "room-2", occasion: "Monthly meeting", total: 9000, paid: 9000, key: "paid-in-full", mode: "email" },
  { day: 9, name: "Danielle Okafor", status: "pending", occasion: "Engagement", total: 46000, key: "confirm-booking", mode: "confirm", createdDay: 3 },
  { day: 10, name: "Mark Whitfield", status: "confirmed", occasion: "Retirement", total: 39000, key: "chase-deposit", mode: "chase" },
  { day: 11, name: "U11 Venus parents", status: "confirmed", room: "room-2", occasion: "Presentation", total: 12000, paid: 12000, key: "paid-in-full", mode: "email" },
  { day: 12, name: "Alan Prideaux", status: "enquiry", occasion: "Anniversary", key: "send-quote", mode: "quote", createdDay: 8 },
  { day: 13, name: "Kelly Broadbent", status: "confirmed", occasion: "Birthday", total: 44000, paid: 10000, key: "await-balance", mode: "chase" },
  { day: 14, name: "Foster & Sons", status: "confirmed", occasion: "Staff party", total: 68000, paid: 68000, key: "paid-in-full", mode: "email" },
  { day: 15, name: "Naomi Clarke", status: "quoted", occasion: "Baby shower", total: 21000, key: "send-chaser", mode: "chase", createdDay: 9 },
  { day: 17, name: "Blocked", status: "confirmed", kind: "block", room: "room-2" },
  { day: 18, name: "Steve Marland", status: "cancelled", occasion: "Wedding reception", total: 72000, key: "re-quote", mode: "quote" },
  { day: 19, name: "Bar staff social", status: "confirmed", occasion: "Club social", total: 0, key: "paid-in-full", mode: "email" },
  { day: 20, name: "Rachel Nnamdi", status: "pending", occasion: "Christening", total: 31000, key: "confirm-booking", mode: "confirm", createdDay: 12 },
  { day: 21, name: "Hale Barns Bowls", status: "confirmed", room: "room-2", occasion: "AGM", total: 11000, paid: 11000, key: "paid-in-full", mode: "email" },
  { day: 22, name: "Gemma Rowntree", status: "enquiry", occasion: "18th birthday", key: "send-quote", mode: "quote", createdDay: 16 },
  { day: 24, name: "Bennett family", status: "confirmed", occasion: "Funeral tea", total: 26000, paid: 26000, key: "paid-in-full", mode: "email" },
  { day: 25, name: "Tania Vasquez", status: "quoted", occasion: "Leaving do", total: 24000, key: "final-offer", mode: "chase", createdDay: 18 },
  { day: 26, name: "Carl Ainsworth", status: "confirmed", occasion: "Charity night", total: 58000, paid: 20000, key: "await-balance", mode: "chase" },
];

function deskBooking(seed: Seed, index: number): DeskBooking {
  const date = dateOn(seed.day);
  const resourceId = seed.room ?? "room-1";
  const total = seed.total ?? null;
  const payments = seed.paid
    ? [
        {
          id: `pay-${index}`,
          amount_pence: seed.paid,
          paid_at: `${dateOn(Math.max(1, seed.day - 1))}T12:00:00.000Z`,
          method: "bank_transfer",
          reference: null,
          refunded_pence: null,
          source: "manual",
          authorised_by_name: "Lyndsey",
          note: null,
          purpose: seed.paid === total ? "balance" : "deposit",
        },
      ]
    : [];

  const facts = {
    status: seed.status,
    starts_at: `${date}T19:00:00.000Z`,
    ends_at: `${date}T23:30:00.000Z`,
    total_pence: total,
    deposit_pence: total ? Math.min(10000, Math.round(total / 2)) : null,
    deposit_due_date: null,
    balance_due_date: null,
    security_deposit_pence: seed.status === "confirmed" ? 10000 : null,
    security_deposit_returned_at: null,
    quote_accepted_at: null,
    chaser_sent_at: null,
    final_chaser_sent_at: null,
  };

  const item: BookingListItem = {
    id: `bk-${index}`,
    resource_id: resourceId,
    date,
    start_time: "19:00",
    end_time: "23:30",
    booker_name: seed.name,
    booker_email: `${seed.name.split(" ")[0]?.toLocaleLowerCase("en-GB")}@example.com`,
    booker_phone: "07700 900123",
    occasion: seed.occasion ?? null,
    estimated_guests: 60,
    status: seed.status,
    payment_status: seed.paid && seed.paid === total ? "paid" : "unpaid",
    total_pence: total,
    kind: seed.kind ?? "hire",
    recurrence_group_id: seed.kind === "block" ? "series-1" : null,
  };

  return {
    id: item.id,
    createdAt: `${dateOn(seed.createdDay ?? 1)}T09:00:00.000Z`,
    item,
    roomName: ROOM_NAME[resourceId] ?? "Function Room",
    next: {
      key: seed.key ?? "paid-in-full",
      label: "Send a quote",
      why: "Nobody has put the club's price on it yet.",
      tone: seed.key === "chase-deposit" ? "error" : "waiting",
      ...(seed.mode ? { mode: seed.mode } : {}),
    },
    sheet: {
      booking: {
        status: seed.status,
        kind: seed.kind ?? "hire",
        booker_email: item.booker_email,
        total_pence: total,
        security_deposit_pence: facts.security_deposit_pence,
        security_deposit_returned_at: null,
        security_deposit_returned_method: null,
        security_deposit_returned_note: null,
        is_member: false,
        membership_type: null,
        member_number: null,
        chaser_sent_at: null,
        final_chaser_sent_at: null,
        final_chaser_discount_pence: null,
      },
      when: { date, startTime: "19:00", endTime: "23:30" },
      money: bookingMoney({ booking: facts, payments, clashes: [] }),
      payments,
      securityPaidPence: 0,
      editInitial: {
        resource_id: resourceId,
        date,
        start_time: "19:00",
        end_time: "23:30",
        booker_first_name: seed.name.split(" ")[0] ?? seed.name,
        booker_last_name: seed.name.split(" ")[1] ?? "",
        booker_email: item.booker_email,
        booker_phone: "07700 900123",
        occasion: seed.occasion ?? "",
        estimated_guests: "60",
        notes: "",
      },
      terms: {
        defaultDepositPence: 10000,
        defaultSecurityDepositPence: 10000,
        defaultMemberDiscountPence: null,
        depositRuleLabel: "half the total cost, up to £100",
        depositRule: { percent: 50, capPence: 10000 },
        needsTerms: false,
      },
    },
  };
}

const DESK = SEEDS.map(deskBooking);
const ITEMS = DESK.map((b) => b.item);
const SUMMARY = deskSummary(DESK);

const CHIP_GROUPS = [
  {
    key: "period",
    label: "When",
    options: [
      { key: "upcoming", href: "/room-bookings?view=list", label: "Upcoming", active: true },
      { key: "past", href: "/room-bookings?view=list&period=past", label: "Past", active: false },
      { key: "all", href: "/room-bookings?view=list&period=all", label: "All dates", active: false },
    ],
  },
  {
    key: "status",
    label: "Where it stands",
    options: [
      { key: "all", href: "/room-bookings?view=list", label: "Everything", count: ITEMS.length, active: true },
      { key: "open", href: "/room-bookings?view=list&status=open", label: "Waiting", count: 5, active: false },
      { key: "quoted", href: "/room-bookings?view=list&status=quoted", label: "Quoted", count: 3, active: false },
      { key: "confirmed", href: "/room-bookings?view=list&status=confirmed", label: "Confirmed", count: 13, active: false },
      { key: "cancelled", href: "/room-bookings?view=list&status=cancelled", label: "Cancelled", count: 1, active: false },
    ],
  },
  {
    key: "room",
    label: "Which room",
    options: [
      { key: "all", href: "/room-bookings?view=list", label: "All rooms", active: true },
      ...ROOMS.map((room) => ({
        key: room.id,
        href: `/room-bookings?view=list&room=${room.id}`,
        label: room.name,
        active: false,
      })),
    ],
  },
];

function Desk({ isCalendar }: { isCalendar: boolean }) {
  return (
    <div className="space-y-3 p-4 lg:p-6">
      <BookingsDesk
        bookings={DESK}
        calendarItems={ITEMS}
        listItems={ITEMS}
        roomName={ROOM_NAME}
        rooms={ROOMS}
        awayEntries={[
          {
            id: "away-1",
            staffId: "s1",
            staffName: "Lyndsey",
            fromDate: dateOn(12),
            toDate: dateOn(19),
            note: "Holiday",
          },
        ]}
        isCalendar={isCalendar}
        summary={SUMMARY}
        chipGroups={isCalendar ? [] : CHIP_GROUPS}
        initialQuery=""
        canDelete
        canDecline
        sheetCanEdit
        sheetCanDelete
        sheetCanEditBooking
      />
    </div>
  );
}

/** Press something on mount, the way the Sheet fixtures open themselves. */
function ClickOnMount({ selector, count = 1 }: { selector: string; count?: number }) {
  useEffect(() => {
    const found = document.querySelectorAll<HTMLElement>(selector);
    for (const element of Array.from(found).slice(0, count)) element.click();
  }, [selector, count]);
  return null;
}

const fixture: Fixture = {
  cases: {
    /**
     * A month of two dozen bookings. At 1440 the claim is that seven columns
     * and their chips fit with nothing wider than the page; at 390 the same
     * case is the week view, which is the regression this PR is about.
     */
    month: () => <Desk isCalendar />,

    /** A press on a booking: the sheet, over the month, on its own door. */
    sheet: () => (
      <>
        <Desk isCalendar />
        <ClickOnMount selector="button.cal-chip" />
      </>
    ),

    /** The list: rows, the URL filters as chips, the search box, the export. */
    list: () => <Desk isCalendar={false} />,

    /** Select armed — two rows ticked and the bulk bar over them. */
    listSelect: () => (
      <>
        <Desk isCalendar={false} />
        <ClickOnMount selector='#root input[type="checkbox"]' count={2} />
      </>
    ),
  },
};

export default fixture;
