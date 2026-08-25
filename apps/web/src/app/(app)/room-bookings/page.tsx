import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile, isStaff, isCommittee, isSuperUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { ExternalLink, Settings, Plus, LayoutList, CalendarDays } from "lucide-react";
import { BlockBookingForm } from "./block-booking-form";
import { BookingsTable } from "./bookings-table";
import { BookingsCalendar } from "./bookings-calendar";
import { StaffAwayPanel } from "./staff-away-panel";
import type { StaffMember, AwayEntry } from "./staff-away-panel";
import { BOOKING_LIST_SELECT, FUNCTION_ROOM, toBookingListItem } from "@/lib/booking-types";
import { londonToday } from "@/lib/booking-time";

type SearchParams = { status?: string; room?: string; period?: string; view?: string };

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

  const { status: statusFilter, room: roomFilter, period: periodFilter, view } = await searchParams;
  const canDelete = isSuperUser(session.profile?.role);
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
    roomResourceIds.length === 0
      ? Promise.resolve({ data: [] })
      : admin
          .from("bookings")
          .select(BOOKING_LIST_SELECT)
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

  // `bookings` stores a timestamptz period; every screen below still works in
  // Europe/London wall clock, so flatten it once here.
  const allBookings = (bookingRows ?? []).map(toBookingListItem);

  // --- List view filtering ---
  const effectivePeriod = periodFilter ?? "upcoming";
  let filtered = allBookings;

  if (!isCalendar) {
    if (effectivePeriod === "upcoming") {
      filtered = filtered.filter((b) => b.date >= todayStr);
    } else if (effectivePeriod === "past") {
      filtered = filtered.filter((b) => b.date < todayStr).reverse();
    }
    if (statusFilter) filtered = filtered.filter((b) => b.status === statusFilter);
    if (roomFilter) filtered = filtered.filter((b) => b.resource_id === roomFilter);
  }

  // Status counts for tab badges
  const base = allBookings.filter((b) => {
    if (effectivePeriod === "upcoming") return b.date >= todayStr;
    if (effectivePeriod === "past") return b.date < todayStr;
    return true;
  }).filter((b) => !roomFilter || b.resource_id === roomFilter);
  const counts = {
    all: base.length,
    pending: base.filter((b) => b.status === "pending").length,
    confirmed: base.filter((b) => b.status === "confirmed").length,
    cancelled: base.filter((b) => b.status === "cancelled").length,
  };

  function filterHref(overrides: Partial<SearchParams>) {
    const p: Record<string, string> = {};
    const merged = { status: statusFilter, room: roomFilter, period: periodFilter, view, ...overrides };
    if (merged.status) p.status = merged.status;
    if (merged.room) p.room = merged.room;
    if (merged.period && merged.period !== "upcoming") p.period = merged.period;
    if (merged.view === "list") p.view = "list"; // calendar is default — only store "list"
    const qs = new URLSearchParams(p).toString();
    return `/room-bookings${qs ? `?${qs}` : ""}`;
  }

  return (
    <>
      <PageHeader
        title="Room Bookings"
        subtitle="Function room hire requests"
        action={
          /* Phone: the header actions become a 2-up grid of 44px targets — the
             block form takes a full row because it expands into a card. */
          <div className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto">
            <Link
              href="/book"
              target="_blank"
              className={buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] lg:min-h-0"}
            >
              <ExternalLink className="h-4 w-4" /> Public page
            </Link>
            <Link
              href="/room-bookings/new"
              className={buttonVariants({ size: "sm" }) + " min-h-[44px] lg:min-h-0"}
            >
              <Plus className="h-4 w-4" /> New booking
            </Link>
            {isCommittee(session.profile?.role) && (
              <>
                <div className="col-span-2 lg:col-span-1 [&>button]:min-h-[44px] [&>button]:w-full lg:[&>button]:min-h-0 lg:[&>button]:w-auto">
                  <BlockBookingForm rooms={rooms ?? []} />
                </div>
                <Link
                  href="/room-bookings/rooms"
                  className={
                    buttonVariants({ variant: "outline", size: "sm" }) +
                    " col-span-2 min-h-[44px] lg:col-span-1 lg:min-h-0"
                  }
                >
                  <Settings className="h-4 w-4" /> Manage rooms
                </Link>
              </>
            )}
          </div>
        }
      />

      <div className="space-y-3 p-4 lg:p-6">
        {/* View toggle + list filters. On a phone the whole strip scrolls
            sideways in its own lane rather than wrapping into four rows. */}
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:gap-3 lg:overflow-visible lg:px-0 lg:pb-0">
          {/* View toggle */}
          <div className="flex shrink-0 rounded-lg border bg-muted/30 p-1 gap-0.5">
            <Link
              href={filterHref({ view: undefined })}
              className={`flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors lg:min-h-0 ${
                isCalendar ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" /> Calendar
            </Link>
            <Link
              href={filterHref({ view: "list" })}
              className={`flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors lg:min-h-0 ${
                !isCalendar ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutList className="h-3.5 w-3.5" /> List
            </Link>
          </div>

          {!isCalendar && (
            <>
              {/* Period */}
              <div className="flex shrink-0 rounded-lg border bg-muted/30 p-1 gap-0.5">
                {(["upcoming", "past", "all"] as const).map((p) => (
                  <Link
                    key={p}
                    href={filterHref({ period: p, status: undefined })}
                    className={`inline-flex min-h-[36px] items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors lg:min-h-0 ${
                      effectivePeriod === p
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p}
                  </Link>
                ))}
              </div>

              {/* Status */}
              <div className="flex shrink-0 rounded-lg border bg-muted/30 p-1 gap-0.5">
                {(["all", "pending", "confirmed", "cancelled"] as const).map((s) => (
                  <Link
                    key={s}
                    href={filterHref({ status: s === "all" ? undefined : s })}
                    className={`inline-flex min-h-[36px] items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors lg:min-h-0 ${
                      (s === "all" && !statusFilter) || statusFilter === s
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s} <span className="ml-1 text-xs opacity-60">({s === "all" ? counts.all : counts[s]})</span>
                  </Link>
                ))}
              </div>

              {/* Room */}
              {(rooms ?? []).length > 1 && (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="whitespace-nowrap text-sm text-muted-foreground">Room:</span>
                  <div className="flex rounded-lg border bg-muted/30 p-1 gap-0.5">
                    <Link
                      href={filterHref({ room: undefined })}
                      className={`inline-flex min-h-[36px] items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors lg:min-h-0 ${
                        !roomFilter ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      All
                    </Link>
                    {(rooms ?? []).map((r) => (
                      <Link
                        key={r.id}
                        href={filterHref({ room: r.id })}
                        className={`inline-flex min-h-[36px] items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors lg:min-h-0 ${
                          roomFilter === r.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {r.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <StaffAwayPanel
          staffList={staffList}
          awayEntries={awayEntries}
          currentUserId={session.userId}
          isCommittee={isCommittee(session.profile?.role)}
        />

        {isCalendar ? (
          <BookingsCalendar
            bookings={allBookings}
            roomName={roomNameRecord}
            awayEntries={awayEntries}
          />
        ) : (
          <BookingsTable
            bookings={filtered}
            roomName={roomNameRecord}
            canDelete={canDelete}
          />
        )}
      </div>
    </>
  );
}
