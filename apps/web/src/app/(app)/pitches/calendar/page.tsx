import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LandPlot,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile } from "@/lib/auth";
import { addDays, isValidDateString, londonToday } from "@/lib/booking-time";
import {
  CALENDAR_FILTERS,
  CALENDAR_GROUP_LABELS,
  countsByGroup,
  dayHeadingLong,
  dayWindow,
  entriesByDate,
  entryTouchesTeams,
  GROUP_STYLES,
  groupsForFilter,
  isCalendarDays,
  isCalendarFilter,
  isCalendarView,
  mondayOf,
  monthGrid,
  monthHeading,
  monthStartOf,
  monthWindow,
  shiftMonth,
  shiftWeek,
  weekendOnly,
  weekHeading,
  weekOf,
  weekWindow,
  type CalendarDays,
  type CalendarEntry,
  type CalendarFilter,
  type CalendarGroup,
  type CalendarView,
} from "@/lib/pitch-calendar";
import { loadPitchCalendar, loadPitchCalendarContext } from "@/lib/pitch-calendar-data";
import { groupByVenue } from "@/lib/pitch-venue";

import { CalendarDatePicker, CalendarFilterSelect, PrintButton } from "./calendar-toolbar";
import { WeekCalendar } from "./calendar-views";
import { ClosePitchForm } from "./closure-form";

/**
 * `/pitches/calendar` — the club's pitch diary (gap 6, legacy-app parity).
 *
 * Distinct from `/pitches`, which is the committee's weekend allocation grid,
 * and from the function-room calendar, which answers a different question
 * about a different resource. This one is for everyone the pitches concern:
 * `pitch_calendar()` returns rows to anyone with a team membership, a child
 * with one, or a club role, and nothing at all to anyone else — which is why
 * "you are not linked to a team yet" is a real answer here and not a guess.
 *
 * Legacy behaviours carried over: week / day / list / month views; weekends
 * only by default (the club's pitch week IS Saturday and Sunday); « » jumps
 * four weeks; venue sections with a venue filter; a team filter; click an
 * empty slot to start a prefilled booking; confirm / decline / cancel in the
 * popover for administrators; a weekly-series marker; Print / PDF.
 *
 * Every filter is in the URL, so a week is a link a coach can send.
 */

export const dynamic = "force-dynamic";

const GROUP_ORDER: CalendarGroup[] = ["fixture", "training", "other", "closed"];

type CalendarSearchParams = {
  date?: string;
  view?: string;
  filter?: string;
  mine?: string;
  days?: string;
  team?: string;
  venue?: string;
};

function buildHref(params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  const text = query.toString();
  return text ? `/pitches/calendar?${text}` : "/pitches/calendar";
}

type BaseState = {
  view: CalendarView;
  filter: CalendarFilter;
  mine: boolean;
  days: CalendarDays;
  team: string;
  venue: string;
};

/** The query the toolbar links and the pickers carry forward. */
function baseParams(state: BaseState): Record<string, string> {
  const params: Record<string, string> = {};
  if (state.view !== "week") params.view = state.view;
  if (state.filter !== "all") params.filter = state.filter;
  if (state.mine) params.mine = "1";
  if (state.days !== "weekend") params.days = state.days;
  if (state.team) params.team = state.team;
  if (state.venue) params.venue = state.venue;
  return params;
}

export default async function PitchCalendarPage({
  searchParams,
}: {
  searchParams: Promise<CalendarSearchParams>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const {
    date,
    view: viewParam,
    filter: filterParam,
    mine: mineParam,
    days: daysParam,
    team: teamParam,
    venue: venueParam,
  } = await searchParams;

  const anchor = date && isValidDateString(date) ? date : londonToday();
  const view: CalendarView = isCalendarView(viewParam) ? viewParam : "week";
  const filter: CalendarFilter = isCalendarFilter(filterParam) ? filterParam : "all";
  const mineRequested = mineParam === "1";
  const daysMode: CalendarDays = isCalendarDays(daysParam) ? daysParam : "weekend";
  const teamFilter = teamParam && /^[0-9a-f-]{36}$/i.test(teamParam) ? teamParam : "";

  const monday = mondayOf(anchor);
  const monthStart = monthStartOf(anchor);
  const window =
    view === "month"
      ? monthWindow(monthStart)
      : view === "day"
        ? dayWindow(anchor)
        : weekWindow(monday);

  const [context, calendar] = await Promise.all([
    loadPitchCalendarContext(),
    loadPitchCalendar(window.from, window.to),
  ]);

  const myTeamIds = new Set(context.myTeamIds);
  const mineAvailable = myTeamIds.size > 0;
  const mine = mineRequested && mineAvailable;

  // Venue grouping comes from the pitch-name convention ("Venue – Pitch 2").
  const venueGroups = groupByVenue(calendar.pitches);
  const venueNames = venueGroups.map((group) => group.venue);
  const venue = venueParam && venueNames.includes(venueParam) ? venueParam : "";
  const visibleGroups = venue
    ? venueGroups.filter((group) => group.venue === venue)
    : venueGroups;

  const groups = groupsForFilter(filter);
  const entries: CalendarEntry[] = calendar.entries.filter((entry) => {
    if (groups && !groups.includes(entry.group)) return false;
    if (mine && !entryTouchesTeams(entry, myTeamIds)) return false;
    if (
      teamFilter &&
      entry.teamId !== teamFilter &&
      !entry.sharedTeamIds.includes(teamFilter)
    ) {
      return false;
    }
    return true;
  });

  // Team options for the filter: every team seen in the loaded window.
  const teamOptions = Array.from(
    new Map(
      calendar.entries
        .filter((entry) => entry.teamId && entry.teamName)
        .map((entry) => [entry.teamId as string, entry.teamName as string]),
    ),
  )
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const state: BaseState = { view, filter, mine, days: daysMode, team: teamFilter, venue };
  const params = baseParams(state);
  const withDate = (extra: Record<string, string>) => ({
    ...params,
    ...(date && isValidDateString(date) ? { date: anchor } : {}),
    ...extra,
  });
  const canAllocate = context.isAdmin;
  const canBook = context.isAdmin || context.staffTeamIds.length > 0;

  // Week/list show Sat+Sun unless all days asked for; day shows the anchor.
  const weekDays =
    view === "day"
      ? [anchor]
      : daysMode === "weekend"
        ? weekendOnly(weekOf(monday).days)
        : weekOf(monday).days;

  // Navigation steps: a day in day view; a week otherwise. Jumps: a week in
  // day view; four weeks otherwise (the legacy « » behaviour).
  const stepBack = view === "day" ? addDays(anchor, -1) : shiftWeek(monday, -1);
  const stepForward = view === "day" ? addDays(anchor, 1) : shiftWeek(monday, 1);
  const jumpBack = view === "day" ? addDays(anchor, -7) : shiftWeek(monday, -4);
  const jumpForward = view === "day" ? addDays(anchor, 7) : shiftWeek(monday, 4);

  const heading =
    view === "month"
      ? monthHeading(monthStart)
      : view === "day"
        ? dayHeadingLong(anchor)
        : weekHeading(monday);

  const header = (
    <PageHeader
      title="Pitch calendar"
      subtitle="Every match, training session and closure on the club's pitches"
      action={
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {canBook && (
            <Link href="/pitches/book" className={buttonVariants({ size: "sm" })}>
              Book a pitch
            </Link>
          )}
          {canAllocate && (
            <Link
              href="/pitches"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <LandPlot className="h-4 w-4" /> Allocate fixtures
            </Link>
          )}
        </div>
      }
    />
  );

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
                <CardTitle>{heading}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground print:hidden">
                  {view === "month"
                    ? "How busy each day is. Pick one to open its week."
                    : view === "day"
                      ? "One day, 08:00–22:00 Europe/London."
                      : daysMode === "weekend"
                        ? "Saturday and Sunday, 08:00–22:00 Europe/London."
                        : "Monday to Sunday, 08:00–22:00 Europe/London."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                {view !== "month" && (
                  <Link
                    href={buildHref(withDate({ date: jumpBack }))}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    aria-label={view === "day" ? "Back a week" : "Back four weeks"}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Link>
                )}
                <Link
                  href={buildHref(
                    withDate({
                      date: view === "month" ? shiftMonth(monthStart, -1) : stepBack,
                    }),
                  )}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  aria-label="Previous"
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Link>
                <Link
                  href={buildHref(params)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Today
                </Link>
                <Link
                  href={buildHref(
                    withDate({
                      date: view === "month" ? shiftMonth(monthStart, 1) : stepForward,
                    }),
                  )}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  aria-label="Next"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Link>
                {view !== "month" && (
                  <Link
                    href={buildHref(withDate({ date: jumpForward }))}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    aria-label={view === "day" ? "Forward a week" : "Forward four weeks"}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Link>
                )}
                <CalendarDatePicker value={anchor} params={params} />
                <PrintButton />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
              <div className="flex flex-wrap items-center gap-1">
                {CALENDAR_FILTERS.map((option) => (
                  <Link
                    key={option.value}
                    href={buildHref(
                      withDate(
                        baseParams({ ...state, filter: option.value }),
                      ),
                    )}
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
                {(
                  [
                    ["week", "Week"],
                    ["day", "Day"],
                    ["list", "List"],
                    ["month", "Month"],
                  ] as const
                ).map(([option, label]) => (
                  <Link
                    key={option}
                    href={buildHref(withDate(baseParams({ ...state, view: option })))}
                    className={buttonVariants({
                      variant: option === view ? "secondary" : "outline",
                      size: "sm",
                    })}
                  >
                    {label}
                  </Link>
                ))}
              </div>

              {view !== "day" && view !== "month" && (
                <Link
                  href={buildHref(
                    withDate(
                      baseParams({
                        ...state,
                        days: daysMode === "weekend" ? "all" : "weekend",
                      }),
                    ),
                  )}
                  className={buttonVariants({
                    variant: daysMode === "weekend" ? "default" : "outline",
                    size: "sm",
                  })}
                >
                  {daysMode === "weekend" ? "Weekends only" : "All days"}
                </Link>
              )}

              {mineAvailable && (
                <Link
                  href={buildHref(withDate(baseParams({ ...state, mine: !mine })))}
                  className={buttonVariants({
                    variant: mine ? "default" : "outline",
                    size: "sm",
                  })}
                >
                  {mine ? "My teams only" : "My teams"}
                </Link>
              )}

              {venueNames.length > 1 && (
                <CalendarFilterSelect
                  label="Venue"
                  paramKey="venue"
                  value={venue}
                  options={venueNames.map((name) => ({ value: name, label: name }))}
                  params={withDate(baseParams({ ...state, venue: "" }))}
                  allLabel="All venues"
                />
              )}

              {teamOptions.length > 0 && (
                <CalendarFilterSelect
                  label="Team"
                  paramKey="team"
                  value={teamFilter}
                  options={teamOptions}
                  params={withDate(baseParams({ ...state, team: "" }))}
                  allLabel="All teams"
                />
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
              <span className="flex items-center gap-1.5">🔁 Weekly series</span>
              {canBook && view !== "month" && view !== "list" && (
                <span className="print:hidden">Click an empty slot to book it.</span>
              )}
            </div>
          </CardHeader>

          <CardContent>
            {view === "month" ? (
              <MonthView
                monthStart={monthStart}
                entries={entries}
                params={baseParams({ ...state, view: "week" })}
              />
            ) : (
              <div className="space-y-8">
                {visibleGroups.map((group) => (
                  <section key={group.venue} className="space-y-3">
                    {venueNames.length > 1 && (
                      <h3 className="border-b pb-1 text-sm font-semibold">{group.venue}</h3>
                    )}
                    <WeekCalendar
                      days={weekDays}
                      pitches={group.pitches}
                      entries={entries.filter((entry) =>
                        group.pitches.some((pitch) => pitch.id === entry.resourceId),
                      )}
                      permissions={{
                        isAdmin: context.isAdmin,
                        staffTeamIds: context.staffTeamIds,
                      }}
                      canBook={canBook}
                      mode={view === "list" ? "list" : "auto"}
                    />
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {canAllocate && (
          <Card className="print:hidden">
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
