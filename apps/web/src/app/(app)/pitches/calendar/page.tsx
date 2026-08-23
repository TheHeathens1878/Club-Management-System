import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, LandPlot } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile } from "@/lib/auth";
import { isValidDateString, londonToday } from "@/lib/booking-time";
import {
  CALENDAR_FILTERS,
  CALENDAR_GROUP_LABELS,
  countsByGroup,
  entriesByDate,
  entryTouchesTeams,
  GROUP_STYLES,
  groupsForFilter,
  isCalendarFilter,
  isCalendarView,
  mondayOf,
  monthGrid,
  monthHeading,
  monthStartOf,
  monthWindow,
  shiftMonth,
  shiftWeek,
  weekHeading,
  weekOf,
  weekWindow,
  type CalendarEntry,
  type CalendarFilter,
  type CalendarGroup,
  type CalendarView,
} from "@/lib/pitch-calendar";
import { loadPitchCalendar, loadPitchCalendarContext } from "@/lib/pitch-calendar-data";

import { CalendarDatePicker } from "./calendar-toolbar";
import { WeekCalendar } from "./calendar-views";
import { ClosePitchForm } from "./closure-form";

/**
 * `/pitches/calendar` — the club's pitch diary (gap 6).
 *
 * Distinct from `/pitches`, which is the committee's weekend allocation grid,
 * and from the function-room calendar, which answers a different question
 * about a different resource. This one is for everyone the pitches concern:
 * `pitch_calendar()` returns rows to anyone with a team membership, a child
 * with one, or a club role, and nothing at all to anyone else — which is why
 * "you are not linked to a team yet" is a real answer here and not a guess.
 *
 * Every filter is in the URL, so a week is a link a coach can send. The only
 * client state on the page is which block is open.
 */

export const dynamic = "force-dynamic";

const GROUP_ORDER: CalendarGroup[] = ["fixture", "training", "other", "closed"];

type CalendarSearchParams = {
  date?: string;
  view?: string;
  filter?: string;
  mine?: string;
};

function buildHref(params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  const text = query.toString();
  return text ? `/pitches/calendar?${text}` : "/pitches/calendar";
}

/** The query the toolbar links and the date picker carry forward. */
function baseParams(view: CalendarView, filter: CalendarFilter, mine: boolean) {
  const params: Record<string, string> = {};
  if (view !== "week") params.view = view;
  if (filter !== "all") params.filter = filter;
  if (mine) params.mine = "1";
  return params;
}

export default async function PitchCalendarPage({
  searchParams,
}: {
  searchParams: Promise<CalendarSearchParams>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { date, view: viewParam, filter: filterParam, mine: mineParam } = await searchParams;

  const anchor = date && isValidDateString(date) ? date : londonToday();
  const view: CalendarView = isCalendarView(viewParam) ? viewParam : "week";
  const filter: CalendarFilter = isCalendarFilter(filterParam) ? filterParam : "all";
  const mineRequested = mineParam === "1";

  const monday = mondayOf(anchor);
  const monthStart = monthStartOf(anchor);
  const window = view === "month" ? monthWindow(monthStart) : weekWindow(monday);

  const [context, calendar] = await Promise.all([
    loadPitchCalendarContext(),
    loadPitchCalendar(window.from, window.to),
  ]);

  // "My teams" narrows to the teams the caller plays in, staffs, or whose
  // children play in — computed from `team_memberships` + `guardianships` under
  // the caller's own RLS. With no teams there is nothing to narrow to, so the
  // toggle is offered but falls back to everything rather than an empty week.
  const myTeamIds = new Set(context.myTeamIds);
  const mineAvailable = myTeamIds.size > 0;
  const mine = mineRequested && mineAvailable;

  const groups = groupsForFilter(filter);
  const entries: CalendarEntry[] = calendar.entries.filter((entry) => {
    if (groups && !groups.includes(entry.group)) return false;
    if (mine && !entryTouchesTeams(entry, myTeamIds)) return false;
    return true;
  });

  const params = baseParams(view, filter, mineRequested && mineAvailable);
  const canAllocate = context.isAdmin;

  const header = (
    <PageHeader
      title="Pitch calendar"
      subtitle="Every match, training session and closure on the club's pitches"
      action={
        <Link
          href="/pitches"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <LandPlot className="h-4 w-4" /> Allocate fixtures
        </Link>
      }
    />
  );

  // Nobody `can_view_pitch_calendar()` accepts — no membership, no guarded
  // child with one, no club role. The database's answer, not a guess.
  //
  // `pitch_calendar()` also lets the `staff`/`club_admin` app roles through by
  // a second route, so an administrator whose week happens to be empty is not
  // told they have no team: the emptiness is real, not a refusal.
  if (calendar.denied && !context.isAdmin && context.staffTeamIds.length === 0) {
    return (
      <>
        <PageHeader
          title="Pitch calendar"
          subtitle="Every match, training session and closure on the club's pitches"
        />
        <div className="max-w-2xl p-6">
          <Card>
            <CardContent className="space-y-3 p-6">
              <p className="text-sm text-muted-foreground">
                You&apos;re not linked to a team yet, so there is no pitch calendar to show. Once
                you — or a child you are guardian of — are in a team, every fixture, training
                session and closure on the club&apos;s pitches appears here.
              </p>
              <Link href="/welcome" className={buttonVariants({ size: "sm" })}>
                Get set up
              </Link>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="space-y-6 p-6">
        {calendar.error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load the pitch calendar: {calendar.error}
          </p>
        )}

        <Card>
          <CardHeader className="gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {view === "month" ? monthHeading(monthStart) : weekHeading(monday)}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {view === "month"
                    ? "How busy each day is. Pick one to open its week."
                    : "Monday to Sunday, 08:00–22:00 Europe/London."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={buildHref({
                    ...params,
                    date:
                      view === "month" ? shiftMonth(monthStart, -1) : shiftWeek(monday, -1),
                  })}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  aria-label={view === "month" ? "Previous month" : "Previous week"}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Link>
                <Link
                  href={buildHref(params)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Today
                </Link>
                <Link
                  href={buildHref({
                    ...params,
                    date: view === "month" ? shiftMonth(monthStart, 1) : shiftWeek(monday, 1),
                  })}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  aria-label={view === "month" ? "Next month" : "Next week"}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Link>
                <CalendarDatePicker value={anchor} params={params} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-1">
                {CALENDAR_FILTERS.map((option) => (
                  <Link
                    key={option.value}
                    href={buildHref({
                      ...baseParams(view, option.value, mineRequested && mineAvailable),
                      ...(date && isValidDateString(date) ? { date: anchor } : {}),
                    })}
                    className={buttonVariants({
                      variant: option.value === filter ? "default" : "outline",
                      size: "sm",
                    })}
                  >
                    {option.label}
                  </Link>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {(["week", "month"] as const).map((option) => (
                  <Link
                    key={option}
                    href={buildHref({
                      ...baseParams(option, filter, mineRequested && mineAvailable),
                      ...(date && isValidDateString(date) ? { date: anchor } : {}),
                    })}
                    className={buttonVariants({
                      variant: option === view ? "secondary" : "outline",
                      size: "sm",
                    })}
                  >
                    {option === "week" ? "Week" : "Month"}
                  </Link>
                ))}
              </div>

              {mineAvailable && (
                <Link
                  href={buildHref({
                    ...baseParams(view, filter, !mine),
                    ...(date && isValidDateString(date) ? { date: anchor } : {}),
                  })}
                  className={buttonVariants({
                    variant: mine ? "default" : "outline",
                    size: "sm",
                  })}
                >
                  {mine ? "My teams only" : "My teams"}
                </Link>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {GROUP_ORDER.map((group) => (
                <span key={group} className="flex items-center gap-1.5">
                  <span
                    className={"h-3 w-3 rounded-sm border " + GROUP_STYLES[group].solid}
                    aria-hidden
                  />
                  {CALENDAR_GROUP_LABELS[group]}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-sm border border-dashed border-foreground/50"
                  aria-hidden
                />
                Not yet confirmed
              </span>
            </div>
          </CardHeader>

          <CardContent>
            {view === "month" ? (
              <MonthView
                monthStart={monthStart}
                entries={entries}
                params={baseParams("week", filter, mineRequested && mineAvailable)}
              />
            ) : (
              <WeekCalendar
                days={weekOf(monday).days}
                pitches={calendar.pitches}
                entries={entries}
                permissions={{ isAdmin: context.isAdmin, staffTeamIds: context.staffTeamIds }}
              />
            )}
          </CardContent>
        </Card>

        {canAllocate && (
          <Card>
            <CardHeader>
              <CardTitle>Close a pitch</CardTitle>
              <p className="text-sm text-muted-foreground">
                A closure is a booking like any other, so nothing can be booked over it and
                everybody sees why. It will be refused if a match or a training session is already
                in that window — cancel or move that first. To lift a closure, click it on the
                calendar and choose &ldquo;Re-open the pitch&rdquo;.
              </p>
            </CardHeader>
            <CardContent>
              <ClosePitchForm pitches={calendar.pitches} defaultDate={anchor} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

/**
 * The month grid: six Monday-first rows, each day carrying how much of each
 * kind is on it, and each day a link into that week.
 */
function MonthView({
  monthStart,
  entries,
  params,
}: {
  monthStart: string;
  entries: CalendarEntry[];
  params: Record<string, string>;
}) {
  const days = monthGrid(monthStart);
  const byDate = entriesByDate(entries);
  const today = londonToday();
  const month = monthStart.slice(0, 7);

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7 gap-1 text-[11px] font-medium text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => (
          <div key={name} className="px-1">
            {name}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const counts = countsByGroup(byDate.get(day) ?? []);
          const inMonth = day.slice(0, 7) === month;
          return (
            <Link
              key={day}
              href={buildHref({ ...params, date: day })}
              className={
                "min-h-[4.5rem] rounded-md border p-1 text-left transition-colors hover:bg-secondary " +
                (inMonth ? "" : "opacity-45 ") +
                (day === today ? "border-primary" : "")
              }
            >
              <span className="block text-xs font-medium">{Number(day.slice(8, 10))}</span>
              <span className="mt-1 flex flex-wrap gap-0.5">
                {GROUP_ORDER.filter((group) => counts[group] > 0).map((group) => (
                  <span
                    key={group}
                    title={`${counts[group]} ${CALENDAR_GROUP_LABELS[group].toLowerCase()}`}
                    className={
                      "rounded-sm border px-1 text-[10px] leading-4 " + GROUP_STYLES[group].solid
                    }
                  >
                    {counts[group]}
                  </span>
                ))}
              </span>
            </Link>
          );
        })}
      </div>
      <p className="pt-2 text-xs text-muted-foreground">
        {entries.length} booking{entries.length === 1 ? "" : "s"} across{" "}
        {monthHeading(monthStart)}. The faded days belong to the months either side — each row is
        a whole Monday-to-Sunday week, so picking one always opens a full week.
      </p>
    </div>
  );
}
