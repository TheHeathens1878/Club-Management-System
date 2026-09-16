"use client";

/**
 * The fixture desk as a grid (P8.4). A row per team in age order, a column
 * per day in the window, every fixture on its own card: the kick-off, who it
 * is against, which way round, the pitch, the replies and the status. The
 * winter-training timetable turned ninety degrees — there a row is a pitch
 * and a column a weekday; here a row is a team and a column a date — so the
 * two screens of the app that answer "what is on, and what still needs
 * doing" behave the same way.
 *
 *   · THE STATUS BAR — "8 to place, 3 short of replies", and the one button
 *     that does something about it: Allocate the unplaced (the sheet opens
 *     already holding all eight), or Add a fixture when nothing is waiting.
 *   · THE GRID — a card opens the fixture sheet where it sits. A home game
 *     with no ground is dashed and says so, with "Place it" on it. An empty
 *     cell's `+` is a new fixture with the team and the date already filled,
 *     which is what retired the old header popover.
 *   · TICKING — the Select chip arms multi-select; tapping cards then fills
 *     the SAME sheet with "12 fixtures" as its object and the identical four
 *     forms, because the server actions have always been bulk. The ticks
 *     survive filtering, as they did on the table.
 *   · BENEATH — the filters and the export, over exactly the rows on screen,
 *     and the print table, which is the only thing a printer gets.
 *
 * A phone cannot show a week of columns, so it opens on the busiest day and
 * the chips move between days.
 *
 * NOTHING HERE IS A PERMISSION. `canManage` is the screen's rule, computed on
 * the server as `capability && !isMemberView(view)`; every action re-checks
 * club admin for itself and RLS has the last word.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, LandPlot, ListChecks, Plus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

import { FixtureSheet, type FixtureSheetFixture, type FixtureSheetMode } from "@/components/fixtures/fixture-sheet";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChipStrip } from "@/components/ui/chip-strip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ActionBar } from "@/components/ui/action-bar";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { compareAgeGroups } from "@/lib/age-group";
import {
  busiestFixtureDay,
  fixtureGridDays,
  fixtureGridRows,
  type FixtureCard,
  type FixtureGridTeam,
  type MatchesAction,
} from "@/lib/fixture-grid";

import { AddFixtureSheet, type AddFixturePrefill } from "./add-fixture-form";
import { exportCsv, exportPdf } from "./matches-export";
import {
  MatchesFilters,
  NO_FILTERS,
  applyFilters,
  filterOptions,
  filtersActive,
  type Filters,
} from "./matches-filters";
import { PrintTable } from "./print-table";
import type { DeskRow } from "./types";

/** What the sheet is holding, and which of its modes is open. */
type SheetState = { ids: string[]; mode: FixtureSheetMode };

function toSheetFixture(row: DeskRow, needsPitch: boolean): FixtureSheetFixture {
  return {
    id: row.id,
    eventId: row.eventId,
    teamId: row.teamId,
    teamName: row.teamName,
    opponent: row.opponent,
    isHome: row.isHome,
    dateLabel: row.date,
    time: row.time,
    pitchLabel: needsPitch ? "Needs a pitch" : row.pitch,
    venueText: row.venueText,
    competition: row.competition,
    status: row.status,
    replies: { in: row.accepted, out: row.declined, total: row.squad },
    needsPitch,
  };
}

export function MatchesGrid({
  rows,
  teams,
  dayLabels,
  nextAction,
  canManage,
  pitches,
  addableTeams,
  focusFirst,
}: {
  rows: DeskRow[];
  /** The teams the grid draws a row for — age group and central venue included. */
  teams: FixtureGridTeam[];
  /** ISO day → "Sat 6 Sept", formatted once on the server. */
  dayLabels: Record<string, string>;
  /** The status bar's sentence and button, from `matchesNextAction()`. */
  nextAction: MatchesAction;
  /** Ticks, the sheet's four forms and the bulk bar — the server re-checks. */
  canManage: boolean;
  /** Active pitches for the sheet's pitch mode; empty hides that mode. */
  pitches: { id: string; name: string }[];
  /** Who the caller may add a fixture for; empty sends them to the team pages. */
  addableTeams: { id: string; name: string }[];
  /** Accent the next match still on as "Next up" (not on Results). */
  focusFirst: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<"kickoff" | "age" | "venue">("kickoff");
  const [day, setDay] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [adding, setAdding] = useState<AddFixturePrefill | null>(null);

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const filtering = filtersActive(filters);
  const options = useMemo(() => filterOptions(rows), [rows]);

  const allDays = useMemo(() => fixtureGridDays(filtered), [filtered]);
  // One day, or every day with something on it. Memoised because it is the
  // grid's column list and `fixtureGridRows` is keyed on it.
  const days = useMemo(
    () => (day !== null && allDays.includes(day) ? [day] : allDays),
    [allDays, day],
  );
  const gridRows = useMemo(() => fixtureGridRows(filtered, teams, days), [filtered, teams, days]);
  const shownRows = gridRows.filter((row) => row.cards.length > 0);

  // A phone cannot show the week: it opens on the day the desk is about.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setDay(busiestFixtureDay(rows));
    // Only on mount — after that the chips are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The rows arrive kick-off ordered from the server and Array.sort is stable,
  // so ordering by age group or venue keeps kick-off order inside each group
  // (Adam, 2026-09-04: "order by Age group from U07 up to Vets" … "And order
  // by venue"). This is what the export and the printed table use; the grid
  // itself is always in age order, because that is what a grid of teams is.
  const ordered = useMemo(() => {
    if (sort === "age") return [...filtered].sort((a, b) => compareAgeGroups(a.ageGroup, b.ageGroup));
    if (sort === "venue") {
      const rank = (v: string) => (v === "Unallocated" ? 2 : v === "Away" ? 1 : 0);
      return [...filtered].sort((a, b) => rank(a.venue) - rank(b.venue) || a.venue.localeCompare(b.venue, "en-GB"));
    }
    return filtered;
  }, [filtered, sort]);

  // "Next up" only means anything of a match still on: a cancelled one at the
  // top of the list is not it.
  const nextUpId = focusFirst ? rows.find((row) => row.status === "scheduled")?.id : undefined;

  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const needsPitchById = useMemo(() => {
    const ids = new Set<string>();
    for (const row of gridRows) for (const card of row.cards) if (card.needsPitch) ids.add(card.id);
    return ids;
  }, [gridRows]);

  const sheetFixtures = useMemo(() => {
    if (!sheet) return [];
    return sheet.ids
      .map((id) => byId.get(id))
      .filter((row): row is DeskRow => row !== undefined)
      .map((row) => toSheetFixture(row, needsPitchById.has(row.id)));
  }, [sheet, byId, needsPitchById]);

  function toggleTick(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCard(card: FixtureCard) {
    if (selecting) toggleTick(card.id);
    else setSheet({ ids: [card.id], mode: "view" });
  }

  /** One unplaced home game, straight into the pitch form. */
  function placeOne(card: FixtureCard) {
    setSheet({ ids: [card.id], mode: "pitch" });
  }

  function runNextAction() {
    if (nextAction.action === "allocate" && canManage && pitches.length > 0) {
      setSheet({ ids: nextAction.fixtureIds, mode: "pitch" });
      return;
    }
    setAdding({});
  }

  // A finished action leaves the rows on screen stale: refetch them and put
  // the ticks down, because the work they described is done.
  function afterAction() {
    setSelected(new Set());
    setSheet(null);
    router.refresh();
  }

  const dayCount = (iso: string) => filtered.filter((row) => row.dateIso === iso).length;
  const canAllocate = canManage && pitches.length > 0;
  const canAdd = addableTeams.length > 0;

  return (
    <div className="space-y-4">
      <ActionBar
        icon={<LandPlot className="h-4 w-4" aria-hidden />}
        tone={nextAction.action === "allocate" ? "waiting" : "idle"}
        status={nextAction.detail}
        detail={
          nextAction.action === "allocate"
            ? canAllocate
              ? "Nothing moves until you press — the sheet opens holding every one of them."
              : "A club administrator puts a fixture on a pitch."
            : "A card opens its fixture; an empty cell adds one where you pressed."
        }
        action={
          nextAction.action === "allocate" && canAllocate ? (
            <Button type="button" size="touch" onClick={runNextAction}>
              <LandPlot className="h-4 w-4" aria-hidden /> {nextAction.label}
            </Button>
          ) : canAdd ? (
            <Button type="button" size="touch" variant={nextAction.action === "add" ? "default" : "outline"} onClick={() => setAdding({})}>
              <CalendarPlus className="h-4 w-4" aria-hidden /> Add a fixture
            </Button>
          ) : (
            <Link href="/teams" className={buttonVariants({ size: "touch", variant: "outline" })}>
              <CalendarPlus className="h-4 w-4" aria-hidden /> Add a fixture
            </Link>
          )
        }
      />

      {/* The day chips, and the tick switch. One line that scrolls on a phone
          rather than a ladder of wrapped rows, so the grid starts higher up
          the screen. The strip's right edge stops at the chip beside it:
          without that the days scroll on underneath it. */}
      <div className="flex items-center gap-2">
        <ChipStrip className="mr-0 min-w-0 flex-1 pr-0">
          <ToggleChip on={day === null} onClick={() => setDay(null)} className="hidden lg:inline-flex">
            Every day
          </ToggleChip>
          {allDays.map((iso) => (
            <ToggleChip key={iso} on={day === iso} count={dayCount(iso)} onClick={() => setDay(iso)}>
              {dayLabels[iso] ?? iso}
            </ToggleChip>
          ))}
        </ChipStrip>
        {canManage ? (
          <ToggleChip
            on={selecting}
            count={selected.size}
            className="flex-none"
            onClick={() => {
              setSelecting((on) => !on);
              if (selecting) setSelected(new Set());
            }}
          >
            <ListChecks className="h-4 w-4" aria-hidden /> Select
          </ToggleChip>
        ) : null}
      </div>

      {selecting && canManage ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            {selected.size === 0
              ? "Tap the matches you want — the ticks survive filtering."
              : `${selected.size} ticked — one sheet acts on all of them.`}
          </span>
          <Button
            type="button"
            size="sm"
            className="touch"
            disabled={selected.size === 0}
            onClick={() => setSheet({ ids: Array.from(selected), mode: "view" })}
          >
            Open the {selected.size || ""} ticked
          </Button>
          <Button type="button" size="sm" variant="ghost" className="touch" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          <p>Nothing on the fixture list for this window.</p>
          <p className="mt-1">Widen the window above, or add the first one — the grid builds itself from there.</p>
        </div>
      ) : shownRows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          <p>No matches fit those filters.</p>
          <Button type="button" size="sm" variant="outline" className="mt-3 touch" onClick={() => setFilters(NO_FILTERS)}>
            Clear the filters
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card print:hidden">
          {/* No `min-w-max`: the track minimums are the grid's own floor, so a
              phone showing one day gets a team column and a day column that
              fit inside 390 and a card that wraps, while a week of columns
              overflows the box above and scrolls sideways, which is what that
              box is for. */}
          <div
            className="grid"
            style={{ gridTemplateColumns: `minmax(120px, 168px) repeat(${days.length}, minmax(196px, 1fr))` }}
          >
            <div className="sticky left-0 z-10 border-b bg-card" />
            {days.map((iso) => (
              <div key={iso} className="border-b border-l px-3 py-2 text-list font-semibold">
                {dayLabels[iso] ?? iso}
                <span className="ml-1.5 font-normal text-muted-foreground">{dayCount(iso) || ""}</span>
              </div>
            ))}

            {shownRows.map((row) => (
              <TeamCells
                key={row.teamId}
                teamName={row.teamName}
                ageGroup={row.ageGroup}
                playsCentrally={row.playsCentrally}
                needsPitch={row.needsPitch}
                days={days}
                byDay={row.byDay}
                selecting={selecting}
                selected={selected}
                openId={sheet && sheet.ids.length === 1 ? (sheet.ids[0] ?? null) : null}
                nextUpId={nextUpId}
                canAllocate={canAllocate}
                canAdd={canAdd}
                onOpen={openCard}
                onPlace={placeOne}
                onAdd={(iso) => setAdding({ teamId: row.teamId, dateIso: iso })}
              />
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------ beneath: narrow, and take away */}
      <div className="space-y-3 print:hidden">
        <div className="rounded-xl border bg-card p-4 shadow-sm lg:p-5">
          <Eyebrow className="mb-3 flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Filters
          </Eyebrow>
          <MatchesFilters
            filters={filters}
            options={options}
            onChange={setFilters}
            onClear={() => setFilters(NO_FILTERS)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-4 shadow-sm lg:p-5">
          <p className="basis-full text-xs text-muted-foreground lg:min-w-0 lg:flex-1 lg:basis-0">
            {filtering
              ? `${filtered.length} of ${rows.length} matches shown`
              : `${rows.length} match${rows.length === 1 ? "" : "es"}`}{" "}
            — the export and the print-out are exactly these.
          </p>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Order by
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              aria-label="Order the matches by"
              className="touch rounded-md border border-input bg-card px-2 text-list lg:min-h-[36px]"
            >
              <option value="kickoff">Kick-off</option>
              <option value="age">Age group (U7 → Vets)</option>
              <option value="venue">Venue</option>
            </select>
          </label>
          <Button type="button" variant="outline" size="touch" disabled={ordered.length === 0} onClick={() => exportCsv(ordered)}>
            Export CSV
          </Button>
          <Button type="button" variant="outline" size="touch" disabled={ordered.length === 0} onClick={() => void exportPdf(ordered)}>
            Export PDF
          </Button>
        </div>
      </div>

      <PrintTable rows={ordered} />

      <FixtureSheet
        open={sheet !== null}
        fixtures={sheetFixtures}
        mode={sheet?.mode ?? "view"}
        onMode={(mode) => setSheet((current) => (current ? { ...current, mode } : current))}
        onClose={() => setSheet(null)}
        canManage={canManage}
        pitches={pitches}
        from="/matches"
        onDone={afterAction}
      />

      <AddFixtureSheet
        open={adding !== null && canAdd}
        teams={addableTeams}
        prefill={adding ?? undefined}
        onClose={() => setAdding(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One team's row across the days
// ---------------------------------------------------------------------------

function TeamCells({
  teamName,
  ageGroup,
  playsCentrally,
  needsPitch,
  days,
  byDay,
  selecting,
  selected,
  openId,
  nextUpId,
  canAllocate,
  canAdd,
  onOpen,
  onPlace,
  onAdd,
}: {
  teamName: string;
  ageGroup: string | null;
  playsCentrally: boolean;
  needsPitch: number;
  days: string[];
  byDay: Record<string, FixtureCard[]>;
  selecting: boolean;
  selected: ReadonlySet<string>;
  openId: string | null;
  nextUpId: string | undefined;
  canAllocate: boolean;
  canAdd: boolean;
  onOpen: (card: FixtureCard) => void;
  onPlace: (card: FixtureCard) => void;
  onAdd: (dayIso: string) => void;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 border-b bg-card px-3 py-2.5">
        <p className="text-list font-semibold leading-tight">{teamName}</p>
        {ageGroup && !teamName.includes(ageGroup) ? (
          <p className="text-2xs text-muted-foreground">{ageGroup}</p>
        ) : null}
        {needsPitch > 0 ? (
          <p className="text-2xs text-warning">
            {needsPitch} without a pitch
          </p>
        ) : playsCentrally ? (
          <p className="text-2xs text-muted-foreground">Plays centrally</p>
        ) : null}
      </div>
      {days.map((iso) => {
        const here = byDay[iso] ?? [];
        return (
          <div key={iso} className="flex flex-col gap-1.5 border-b border-l p-1.5">
            {here.map((card) => (
              <GridCard
                key={card.id}
                card={card}
                selecting={selecting}
                ticked={selected.has(card.id)}
                open={openId === card.id}
                nextUp={nextUpId === card.id}
                canAllocate={canAllocate}
                onOpen={onOpen}
                onPlace={onPlace}
              />
            ))}
            {canAdd ? (
              <button
                type="button"
                onClick={() => onAdd(iso)}
                aria-label={`Add a fixture for ${teamName} on this day`}
                title="Add a fixture here"
                className={
                  "touch inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition-opacity hover:border-primary/50 hover:text-primary lg:min-h-[28px] " +
                  (here.length === 0 ? "opacity-70" : "opacity-40 hover:opacity-100 focus-visible:opacity-100")
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {here.length === 0 ? "Add a fixture" : null}
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// One fixture, on its card
// ---------------------------------------------------------------------------

function GridCard({
  card,
  selecting,
  ticked,
  open,
  nextUp,
  canAllocate,
  onOpen,
  onPlace,
}: {
  card: FixtureCard;
  selecting: boolean;
  ticked: boolean;
  open: boolean;
  nextUp: boolean;
  canAllocate: boolean;
  onOpen: (card: FixtureCard) => void;
  onPlace: (card: FixtureCard) => void;
}) {
  const short = card.replies.total > 0 && card.replies.in * 2 < card.replies.total;
  const cancelled = card.status === "cancelled";
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selecting ? ticked : undefined}
      onClick={() => onOpen(card)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(card);
        }
      }}
      aria-label={`${card.time} ${card.homeAway === "H" ? "home to" : "away at"} ${card.opponent} — ${card.pitchLabel}, ${card.replies.in} of ${card.replies.total} in`}
      className={
        "cursor-pointer rounded-lg border p-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        (ticked
          ? "border-primary bg-primary/10"
          : open
            ? "border-primary ring-2 ring-primary/30"
            : card.needsPitch
              ? "border-dashed border-warning/50 bg-warning-tint hover:border-warning"
              : "border-border bg-card hover:border-primary/50") +
        (cancelled ? " opacity-70" : "")
      }
    >
      {nextUp ? <Eyebrow tone="primary" className="mb-0.5 block">Next up</Eyebrow> : null}
      <div className="flex items-start gap-1">
        <span className="min-w-0 flex-1 text-list font-semibold leading-tight">
          {card.time} · v {card.opponent}{" "}
          <span className="font-normal text-muted-foreground">({card.homeAway})</span>
        </span>
        {selecting ? (
          <span
            className={
              "flex h-5 w-5 flex-none items-center justify-center rounded-md border " +
              (ticked ? "border-primary bg-primary text-primary-foreground" : "border-input")
            }
            aria-hidden
          >
            {ticked ? <Check className="h-3.5 w-3.5" /> : null}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Badge variant={card.needsPitch ? "warning" : "outline"} className="px-1.5 text-2xs">
          {card.pitchLabel}
        </Badge>
        <Badge
          variant={short ? "destructive" : card.replies.in > 0 ? "success" : "muted"}
          className="px-1.5 text-2xs"
        >
          {card.replies.in} of {card.replies.total} in
        </Badge>
        {card.replies.out > 0 ? (
          <Badge variant="muted" className="px-1.5 text-2xs">
            {card.replies.out} out
          </Badge>
        ) : null}
        {card.status !== "scheduled" ? (
          <Badge variant="muted" className="px-1.5 text-2xs">
            {card.status}
          </Badge>
        ) : null}
      </div>
      {card.needsPitch && canAllocate && !selecting ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-1.5 w-full touch"
          onClick={(event) => {
            event.stopPropagation();
            onPlace(card);
          }}
        >
          <LandPlot className="h-3.5 w-3.5" aria-hidden /> Place it
        </Button>
      ) : null}
    </div>
  );
}
