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
  if (!isStaff(session.profile?.role)) redirect("/login");

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
          <div className="flex gap-2">
            <Link
              href="/book"
              target="_blank"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ExternalLink className="h-4 w-4" /> Public page
            </Link>
            <Link
              href="/room-bookings/new"
              className={buttonVariants({ size: "sm" })}
            >
              <Plus className="h-4 w-4" /> New booking
            </Link>
            {isCommittee(session.profile?.role) && (
              <>
                <BlockBookingForm rooms={rooms ?? []} />
                <Link
                  href="/room-bookings/rooms"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <Settings className="h-4 w-4" /> Manage rooms
                </Link>
              </>
            )}
          </div>
        }
      />

      <div className="p-6 space-y-3">
        {/* View toggle + list filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* View toggle */}
          <div className="flex rounded-lg border bg-muted/30 p-1 gap-0.5">
            <Link
              href={filterHref({ view: undefined })}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isCalendar ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" /> Calendar
            </Link>
            <Link
              href={filterHref({ view: "list" })}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                !isCalendar ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutList className="h-3.5 w-3.5" /> List
            </Link>
          </div>

          {!isCalendar && (
            <>
              {/* Period */}
              <div className="flex rounded-lg border bg-muted/30 p-1 gap-0.5">
                {(["upcoming", "past", "all"] as const).map((p) => (
                  <Link
                    key={p}
                    href={filterHref({ period: p, status: undefined })}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors capitalize ${
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
              <div className="flex rounded-lg border bg-muted/30 p-1 gap-0.5">
                {(["all", "pending", "confirmed", "cancelled"] as const).map((s) => (
                  <Link
                    key={s}
                    href={filterHref({ status: s === "all" ? undefined : s })}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors capitalize ${
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
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Room:</span>
                  <div className="flex rounded-lg border bg-muted/30 p-1 gap-0.5">
                    <Link
                      href={filterHref({ room: undefined })}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        !roomFilter ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      All
                    </Link>
                    {(rooms ?? []).map((r) => (
                      <Link
                        key={r.id}
                        href={filterHref({ room: r.id })}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
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
