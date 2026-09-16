import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile, isStaff, isCommittee, isSuperUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { FoldCard } from "@/components/ui/fold-card";
import { DoorOpen, ExternalLink, Settings, Plus, UserX } from "lucide-react";
import { BlockBookingForm } from "./block-booking-form";
import { BookingsDesk } from "./bookings-desk";
import { StaffAwayPanel } from "./staff-away-panel";
import type { StaffMember, AwayEntry } from "./staff-away-panel";
import type { ChipGroup } from "./bookings-table";
import {
  awaySummary,
  deskClashes,
  deskSummary,
  filterSummary,
  type DeskBooking,
} from "./desk-shared";
import { bookingMoney, bookingNeedsTerms, bookingNextAction } from "@/lib/booking-next-action";
import {
  FUNCTION_ROOM,
  toBookingListItem,
  type BookingRow,
  type PaymentRow as PaymentDbRow,
} from "@/lib/booking-types";
import { instantsToLocalWindow, londonToday } from "@/lib/booking-time";
import { bookingDepositPence, depositRuleFrom, depositRuleLabel, sumSecurityPaid } from "@/lib/hire-terms";
import { splitContactName } from "@/lib/person-name";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Room Bookings" };

type SearchParams = { status?: string; room?: string; period?: string; view?: string; q?: string };

export default async function RoomBookingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  // Signed in but not staff: the club lobby, not /login — sending somebody who
  // IS signed in back to the sign-in page is the loop Adam hit.
  if (!isStaff(session.profile?.role)) redirect("/lobby");

  const { status: statusFilter, room: roomFilter, period: periodFilter, view, q } = await searchParams;
  const canDelete = isSuperUser(session.profile?.role);
  // Declining a block booking is a committee decision, which is what the
  // database has always said: bookings_admin_delete is is_club_admin().
  const canDecline = isCommittee(session.profile?.role);
  const isCalendar = view !== "list"; // calendar is the default

  const admin = createAdminClient();
  // UK "today" date — server runs UTC, so use London timezone
  const todayStr = londonToday();

  // The bookings table also holds every PITCH booking (fixtures, training —
  // gap 3 and the Neon import), and those belong to /pitches/calendar, not
  // here. Scope this page to function-room resources — all of them, active or
  // not, so a deactivated room's history stays visible.
  const { data: roomResourceRows } = await admin
    .from("resources")
    .select("id")
    .eq("type", FUNCTION_ROOM);
  const roomResourceIds = (roomResourceRows ?? []).map((row) => row.id);

  const [{ data: bookingRows }, { data: rooms }, { data: staffProfiles }, { data: awayRows }, { data: nonUserStaffRows }, authUsersResult] = await Promise.all([
    // The whole row, not the list's dozen columns: a press on the calendar
    // opens `BookingSheet` on the booking, and the sheet wants the terms, the
    // deadlines and the chaser stamps. Forty-eight rows on the club's
    // database — the desk has always read every one of them anyway.
    roomResourceIds.length === 0
      ? Promise.resolve({ data: [] as BookingRow[] })
      : admin
          .from("bookings")
          .select("*")
          .in("resource_id", roomResourceIds)
          .order("starts_at", { ascending: true }),
    admin
      .from("resources")
      .select("id,name")
      .eq("type", FUNCTION_ROOM)
      .eq("active", true)
      .order("sort_order"),
    admin.from("profiles").select("id,full_name,role").in("role", ["bar", "committee", "super_user"]),
    admin.from("staff_away").select("id,staff_id,non_user_staff_id,from_date,to_date,note").order("from_date"),
    admin.from("non_user_staff").select("id,name").eq("active", true).order("name"),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const rawBookings = bookingRows ?? [];

  // The ledger for every booking on the desk, in one query rather than one per
  // row: what has been paid is what decides whether a deposit is overdue.
  const bookingIds = rawBookings.map((row) => row.id);
  const paymentQuery = bookingIds.length
    ? await admin.from("payments").select("*").in("booking_id", bookingIds).order("paid_at", { ascending: false })
    : null;
  const paymentRows: PaymentDbRow[] = paymentQuery?.data ?? [];
  const paymentsByBooking = new Map<string, PaymentDbRow[]>();
  for (const payment of paymentRows) {
    // `payments.booking_id` is nullable (a subs payment belongs to a person,
    // not a hire); the `in` above only asked for hires, but the type is honest.
    const bookingId = payment.booking_id;
    if (!bookingId) continue;
    const existing = paymentsByBooking.get(bookingId);
    if (existing) existing.push(payment);
    else paymentsByBooking.set(bookingId, [payment]);
  }

  // Use email as a fallback for profile users who haven't set their name yet
  const authEmailById = new Map(
    (authUsersResult.data?.users ?? []).map((u) => [u.id, u.email ?? ""])
  );

  const staffList: StaffMember[] = [
    ...(staffProfiles ?? []).map((p) => ({
      id: p.id,
      name: p.full_name ?? authEmailById.get(p.id) ?? p.id.slice(0, 8),
      role: p.role as string,
      type: "profile" as const,
    })),
    ...(nonUserStaffRows ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      role: "external",
      type: "external" as const,
    })),
  ];

  const staffNameById = new Map(staffList.map((s) => [s.id, s.name]));

  const awayEntries: AwayEntry[] = (awayRows ?? []).map((r) => {
    const staffId = r.staff_id ?? r.non_user_staff_id ?? "";
    return {
      id: r.id,
      staffId,
      staffName: staffNameById.get(staffId) ?? "Unknown",
      fromDate: r.from_date,
      toDate: r.to_date,
      note: r.note,
    };
  });

  const roomNameRecord: Record<string, string> = Object.fromEntries(
    (rooms ?? []).map((r) => [r.id, r.name])
  );

  // What the rooms fold says while it is shut: which rooms are on the books,
  // and that the public form is where a hirer starts.
  const roomList = (rooms ?? []).map((r) => r.name);
  const roomsSummary =
    roomList.length === 0
      ? "No rooms set up yet — nothing can be hired until there is one"
      : `${roomList.join(" · ")} · the public page takes enquiries`;

  // The club's terms, read once: the same deposit rule the record page offers
  // at confirmation, so the desk's sheet prefills what the record's would.
  const settings = await getSettings();
  const depositRule = depositRuleFrom(settings);
  const memberDiscountDefault = Number(settings.room_member_discount_pence) || 0;
  const securityDefaultPence = Number(settings.security_deposit_default_pence) || 0;

  const now = new Date();

  // `bookings` stores a timestamptz period; every screen below still works in
  // Europe/London wall clock, so flatten it once here — and, beside each row,
  // work out the one thing it needs next and everything its sheet will ask for.
  const desk: DeskBooking[] = rawBookings.map((row) => {
    const when = instantsToLocalWindow(row.starts_at, row.ends_at);
    const payments = (paymentsByBooking.get(row.id) ?? []).map((p) => ({
      id: p.id,
      amount_pence: p.amount_pence,
      paid_at: p.paid_at,
      method: p.method,
      reference: p.reference,
      refunded_pence: p.refunded_pence,
      source: p.source,
      authorised_by_name: p.authorised_by_name,
      note: p.note,
      purpose: p.purpose,
    }));
    const input = { booking: row, payments, clashes: deskClashes(rawBookings, row) };
    const action = bookingNextAction(input, { voice: "desk" as const, now });
    const names = splitContactName(row.booker_name);

    return {
      id: row.id,
      createdAt: row.created_at,
      item: toBookingListItem(row),
      roomName: roomNameRecord[row.resource_id] ?? "Unknown room",
      next: {
        key: action.key,
        label: action.label,
        why: action.why,
        tone: action.tone,
        ...(action.mode ? { mode: action.mode } : {}),
      },
      sheet: {
        booking: {
          status: row.status,
          kind: row.kind,
          booker_email: row.booker_email,
          total_pence: row.total_pence,
          security_deposit_pence: row.security_deposit_pence,
          security_deposit_returned_at: row.security_deposit_returned_at,
          security_deposit_returned_method: row.security_deposit_returned_method,
          security_deposit_returned_note: row.security_deposit_returned_note,
          is_member: row.is_member,
          membership_type: row.membership_type,
          member_number: row.member_number,
          chaser_sent_at: row.chaser_sent_at,
          final_chaser_sent_at: row.final_chaser_sent_at,
          final_chaser_discount_pence: row.final_chaser_discount_pence,
        },
        when,
        money: bookingMoney(input),
        payments,
        securityPaidPence: sumSecurityPaid(payments),
        editInitial: {
          resource_id: row.resource_id,
          date: when.date,
          start_time: when.startTime,
          end_time: when.endTime,
          booker_first_name: row.booker_first_name ?? names.firstName,
          booker_last_name: row.booker_last_name ?? names.lastName,
          booker_email: row.booker_email,
          booker_phone: row.booker_phone ?? "",
          occasion: row.occasion ?? "",
          estimated_guests: row.estimated_guests === null ? "" : String(row.estimated_guests),
          notes: row.notes ?? "",
        },
        terms: {
          defaultDepositPence: bookingDepositPence(row, depositRule),
          defaultSecurityDepositPence: securityDefaultPence,
          defaultMemberDiscountPence: row.is_member ? memberDiscountDefault : null,
          depositRuleLabel: depositRuleLabel(depositRule),
          depositRule,
          needsTerms: bookingNeedsTerms(row),
        },
      },
    };
  });

  const allBookings = desk.map((b) => b.item);

  // --- List view filtering ---
  const effectivePeriod = periodFilter ?? "upcoming";
  let filtered = allBookings;

  if (!isCalendar) {
    if (effectivePeriod === "upcoming") {
      filtered = filtered.filter((b) => b.date >= todayStr);
    } else if (effectivePeriod === "past") {
      filtered = filtered.filter((b) => b.date < todayStr).reverse();
    }
    // "open" is everything the desk owes an answer: a pending request or an
    // enquiry. It is what the nav's number counts (lib/nav-counts).
    if (statusFilter === "open") filtered = filtered.filter((b) => b.status === "pending" || b.status === "enquiry");
    else if (statusFilter) filtered = filtered.filter((b) => b.status === statusFilter);
    if (roomFilter) filtered = filtered.filter((b) => b.resource_id === roomFilter);
  }

  // Status counts for the chips
  const base = allBookings.filter((b) => {
    if (effectivePeriod === "upcoming") return b.date >= todayStr;
    if (effectivePeriod === "past") return b.date < todayStr;
    return true;
  }).filter((b) => !roomFilter || b.resource_id === roomFilter);
  const counts = {
    all: base.length,
    open: base.filter((b) => b.status === "pending" || b.status === "enquiry").length,
    enquiry: base.filter((b) => b.status === "enquiry").length,
    quoted: base.filter((b) => b.status === "quoted").length,
    pending: base.filter((b) => b.status === "pending").length,
    confirmed: base.filter((b) => b.status === "confirmed").length,
    cancelled: base.filter((b) => b.status === "cancelled").length,
  };

  // What the desk owes the world, over the upcoming bookings — the same window
  // the chips count, so the bar and the chips cannot disagree.
  const upcomingIds = new Set(base.map((b) => b.id));
  const summary = deskSummary(desk.filter((b) => upcomingIds.has(b.id)));

  function filterHref(overrides: Partial<SearchParams>) {
    const p: Record<string, string> = {};
    const merged = { status: statusFilter, room: roomFilter, period: periodFilter, view, q, ...overrides };
    if (merged.status) p.status = merged.status;
    if (merged.room) p.room = merged.room;
    if (merged.period && merged.period !== "upcoming") p.period = merged.period;
    if (merged.view === "list") p.view = "list"; // calendar is default — only store "list"
    if (merged.q) p.q = merged.q;
    const qs = new URLSearchParams(p).toString();
    return `/room-bookings${qs ? `?${qs}` : ""}`;
  }

  // The list's three filter strips, as chips above the rows. Every one is a
  // URL, so a narrowed desk can be sent to a colleague.
  const chipGroups: ChipGroup[] = [
    {
      key: "view",
      label: "How to read it",
      options: [
        { key: "calendar", href: filterHref({ view: undefined }), label: "Calendar", active: isCalendar },
        { key: "list", href: filterHref({ view: "list" }), label: "List", active: !isCalendar },
      ],
    },
    {
      key: "period",
      label: "When",
      options: (["upcoming", "past", "all"] as const).map((p) => ({
        key: p,
        href: filterHref({ period: p, status: undefined }),
        label: p === "upcoming" ? "Upcoming" : p === "past" ? "Past" : "All dates",
        active: effectivePeriod === p,
      })),
    },
    {
      key: "status",
      label: "Where it stands",
      options: (["all", "open", "enquiry", "quoted", "pending", "confirmed", "cancelled"] as const).map((s) => ({
        key: s,
        href: filterHref({ status: s === "all" ? undefined : s }),
        label:
          s === "open"
            ? "Waiting"
            : s === "all"
              ? "Everything"
              : s.charAt(0).toUpperCase() + s.slice(1),
        count: s === "all" ? counts.all : counts[s],
        active: (s === "all" && !statusFilter) || statusFilter === s,
      })),
    },
    ...((rooms ?? []).length > 1
      ? [
          {
            key: "room",
            label: "Which room",
            options: [
              {
                key: "all",
                href: filterHref({ room: undefined }),
                label: "All rooms",
                active: !roomFilter,
              },
              ...(rooms ?? []).map((r) => ({
                key: r.id,
                href: filterHref({ room: r.id }),
                label: r.name,
                active: roomFilter === r.id,
              })),
            ],
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Room Bookings"
        subtitle="Function room hire requests"
        action={
          /* One door in the header (P8.2b). Blocking a night, the public page
             and the rooms themselves are settings about the room rather than
             work on a booking, so they fold beneath the diary. */
          <Link
            href="/room-bookings/new"
            className={buttonVariants({ size: "touch", className: "w-full lg:w-auto" })}
          >
            <Plus className="h-4 w-4" aria-hidden /> New booking
          </Link>
        }
      />

      <div className="space-y-3 p-4 lg:p-6">
        <BookingsDesk
          bookings={desk}
          calendarItems={allBookings}
          listItems={filtered}
          roomName={roomNameRecord}
          rooms={rooms ?? []}
          awayEntries={awayEntries}
          isCalendar={isCalendar}
          summary={summary}
          chipGroups={chipGroups}
          filterSummary={filterSummary({
            period: effectivePeriod,
            status: statusFilter,
            statusCount: statusFilter === "open" ? counts.open : undefined,
            roomName: roomFilter ? roomNameRecord[roomFilter] : undefined,
            calendar: isCalendar,
          })}
          initialQuery={q ?? ""}
          canDelete={canDelete}
          canDecline={canDecline}
          sheetCanEdit={isStaff(session.profile?.role)}
          sheetCanDelete={isCommittee(session.profile?.role)}
          sheetCanEditBooking={isSuperUser(session.profile?.role)}
        />

        {/* Folded beneath the diary: who is off, and the room itself. Each row
            says what it holds while it is shut, worked out here on the server
            (the benchmark's fifth rule). */}
        <FoldCard
          icon={<UserX className="h-4 w-4" aria-hidden />}
          title="Staff away"
          summary={awaySummary(awayEntries, todayStr)}
          className="cal-no-print"
        >
          <StaffAwayPanel
            staffList={staffList}
            awayEntries={awayEntries}
            currentUserId={session.userId}
            isCommittee={isCommittee(session.profile?.role)}
          />
        </FoldCard>

        <FoldCard
          icon={<DoorOpen className="h-4 w-4" aria-hidden />}
          title="Rooms and the public page"
          summary={roomsSummary}
          className="cal-no-print"
        >
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              What the club hires out, what a hirer sees, and how to take a night off the market
              before anybody asks for it.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/book"
                target="_blank"
                className={buttonVariants({ variant: "outline", size: "touch" })}
              >
                <ExternalLink className="h-4 w-4" aria-hidden /> The public page
              </Link>
              {isCommittee(session.profile?.role) && (
                <>
                  <Link
                    href="/room-bookings/rooms"
                    className={buttonVariants({ variant: "outline", size: "touch" })}
                  >
                    <Settings className="h-4 w-4" aria-hidden /> Manage rooms
                  </Link>
                  <div className="[&>button]:touch">
                    <BlockBookingForm rooms={rooms ?? []} />
                  </div>
                </>
              )}
            </div>
          </div>
        </FoldCard>
      </div>
    </>
  );
}
