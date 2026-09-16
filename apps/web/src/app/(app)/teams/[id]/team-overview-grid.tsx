"use client";

/**
 * A team's week, as a grid (P8.7b).
 *
 * The Overview tab used to open with the next match printed twice — a paper
 * card for a phone and an ink card for a desk — then an availability list,
 * then twenty kick-offs in a table, then a shut disclosure holding a second,
 * plainer copy of those same matches with tick boxes beside them. Four
 * presentations of one weekend.
 *
 * It is one grid now: two rows, seven days. The MATCHES row is
 * `fixtureGridRows()` — the same function `/matches` draws its desk with —
 * and the TRAINING row is `trainingWeekRows()`, the one `/training` draws its
 * week with. Neither is a third card shape invented for this screen; a
 * fixture card here is the fixture card there, so a coach who has learnt one
 * screen has learnt all three.
 *
 * Above it, the one thing the team is waiting for, from `teamNextAction()`:
 * allocate a pitch, remind the quiet ones, or open the register. Below it,
 * the board and the chat exactly as they were.
 *
 * A fixture card opens `FixtureSheet` — view, kick-off, pitch, cancel,
 * delete, the same four forms `/matches` opens. That is what retired
 * `manage-matches-panel.tsx`: its three buttons ARE those forms, and its
 * ticks are the Select chip, because the server actions behind them have
 * always been bulk.
 *
 * NOTHING HERE IS A PERMISSION. `canManage` is the screen's rule computed on
 * the server (`allocationTools`); every action re-checks club admin for
 * itself and RLS has the last word.
 *
 * An empty TRAINING cell is a one-press booking with the team and the date
 * filled in. An empty MATCHES cell is not: a fixture arrives from the FA
 * importer or the manual entry screen, so a `+` there would promise a door
 * this team page does not have.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BellRing,
  CalendarClock,
  ClipboardCheck,
  LandPlot,
  ListChecks,
  Check,
  Plus,
} from "lucide-react";

import {
  FixtureSheet,
  type FixtureSheetFixture,
  type FixtureSheetMode,
} from "@/components/fixtures/fixture-sheet";
import { ActionBar } from "@/components/ui/action-bar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChipStrip } from "@/components/ui/chip-strip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import {
  fixtureGridRows,
  type FixtureCard,
  type FixtureGridFixture,
  type FixtureGridTeam,
} from "@/lib/fixture-grid";
import type { TeamAction } from "@/lib/team-next-action";
import {
  dayWord,
  trainingWeekRows,
  type SessionCard,
  type TrainingWeekSession,
} from "@/lib/training-week";

export type TeamOverviewGridProps = {
  team: FixtureGridTeam;
  /** This team's fixtures, already in the desk's own row shape. */
  fixtures: FixtureGridFixture[];
  /** This team's pitch slots that are not a match's own allocated slot. */
  sessions: TrainingWeekSession[];
  /** Seven ISO days, today first, fixed — the empty ones are the point. */
  days: string[];
  /** ISO day → "Sat 6 Sep", formatted once on the server. */
  dayLabels: Record<string, string>;
  /** ISO day → "Saturday", for the chips and the column heads. */
  dayChips: Record<string, string>;
  today: string;
  /** What the bar says and what its button does, from `teamNextAction()`. */
  next: TeamAction;
  /** The four fixture forms and the ticks. The server worked this out. */
  canManage: boolean;
  /** Active pitches for the sheet's pitch mode; empty hides that mode. */
  pitches: { id: string; name: string }[];
  /** The register door — `/pitches/{bookingId}` — is staff furniture. */
  canTakeRegister: boolean;
};

/** What the sheet is holding, and which of its modes is open. */
type SheetState = { ids: string[]; mode: FixtureSheetMode };

export function TeamOverviewGrid({
  team,
  fixtures,
  sessions,
  days,
  dayLabels,
  dayChips,
  today,
  next,
  canManage,
  pitches,
  canTakeRegister,
}: TeamOverviewGridProps) {
  /** null = the whole week (lg only). */
  const [day, setDay] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<SheetState | null>(null);

  // A phone cannot hold seven columns: it opens on today, and after that the
  // chips are the coach's.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setDay(days[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shownDays = day === null ? days : [day];

  const fixtureRow = useMemo(
    () => fixtureGridRows(fixtures, [team], days)[0] ?? null,
    [fixtures, team, days],
  );
  const sessionRow = useMemo(
    () =>
      trainingWeekRows(sessions, [{ id: team.id, name: team.name, ageGroup: team.ageGroup }], days)[0] ??
      null,
    [sessions, team, days],
  );

  const byId = useMemo(
    () => new Map((fixtureRow?.cards ?? []).map((card) => [card.id, card])),
    [fixtureRow],
  );
  const cardCount = fixtureRow?.cards.length ?? 0;

  const sheetFixtures: FixtureSheetFixture[] = useMemo(() => {
    if (!sheet) return [];
    return sheet.ids
      .map((id) => byId.get(id))
      .filter((card): card is FixtureCard => card !== undefined)
      .map((card) => ({
        id: card.id,
        eventId: card.eventId,
        teamId: card.teamId,
        teamName: team.name,
        opponent: card.opponent,
        isHome: card.homeAway === "H",
        dateLabel: dayLabels[card.dayIso] ?? card.dayIso,
        time: card.time,
        pitchLabel: card.pitchLabel,
        status: card.status,
        replies: card.replies,
        needsPitch: card.needsPitch,
      }));
  }, [sheet, byId, dayLabels, team.name]);

  function toggleTick(id: string) {
    setSelected((current) => {
      const nextSet = new Set(current);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  }

  function openCard(card: FixtureCard) {
    if (selecting) toggleTick(card.id);
    else setSheet({ ids: [card.id], mode: "view" });
  }

  const dayFixtures = (iso: string) => (fixtureRow?.byDay[iso] ?? []).length;
  const daySessions = (iso: string) => (sessionRow?.byDay[iso] ?? []).length;
  const canAllocate = canManage && pitches.length > 0;

  /** The bar's button: one press, on the thing the bar is about. */
  const action = (() => {
    // The bar is about the TEAM, not about the seven days on screen: a game
    // eleven days out is still what this team is waiting on. When its card is
    // not in the grid there is nothing for a sheet to open over, so the button
    // becomes the door to Pitches instead of a panel about an invisible match.
    if (next.mode === "pitch" && next.fixtureId) {
      return canAllocate && byId.has(next.fixtureId) ? (
        <Button
          type="button"
          size="touch"
          onClick={() => setSheet({ ids: [next.fixtureId as string], mode: "pitch" })}
        >
          <LandPlot className="h-4 w-4" aria-hidden /> {next.label}
        </Button>
      ) : (
        <Link href="/pitches" className={buttonVariants({ size: "touch", variant: "outline" })}>
          <LandPlot className="h-4 w-4" aria-hidden /> Open Pitches
        </Link>
      );
    }
    if (next.mode === "remind" && next.eventId) {
      return (
        <Link
          href={`/events/${next.eventId}?from=/teams/${team.id}`}
          className={buttonVariants({ size: "touch" })}
        >
          <BellRing className="h-4 w-4" aria-hidden /> {next.label}
        </Link>
      );
    }
    if (next.mode === "register" && next.bookingId && canTakeRegister) {
      return (
        <Link
          href={`/pitches/${next.bookingId}`}
          className={buttonVariants({ size: "touch" })}
        >
          <ClipboardCheck className="h-4 w-4" aria-hidden /> {next.label}
        </Link>
      );
    }
    return (
      <Link
        href={`/teams/${team.id}?tab=settings`}
        className={buttonVariants({ size: "touch", variant: "outline" })}
      >
        <CalendarClock className="h-4 w-4" aria-hidden /> Import fixtures
      </Link>
    );
  })();

  return (
    <section className="space-y-3">
      <ActionBar
        icon={
          next.mode === "pitch" ? (
            <LandPlot className="h-4 w-4" aria-hidden />
          ) : next.mode === "remind" ? (
            <BellRing className="h-4 w-4" aria-hidden />
          ) : next.mode === "register" ? (
            <ClipboardCheck className="h-4 w-4" aria-hidden />
          ) : (
            <CalendarClock className="h-4 w-4" aria-hidden />
          )
        }
        tone={next.mode === "none" ? "idle" : "waiting"}
        status={next.detail}
        detail={
          next.mode === "pitch"
            ? "A home game with nowhere to play is a Saturday nobody can get to."
            : next.mode === "remind"
              ? "Somebody who has said no has answered. This goes to the people who have said nothing."
              : next.mode === "register"
                ? "The register can be taken any time before the whistle."
                : "A card opens the match; an empty evening books a pitch."
        }
        action={action}
      />

      <div className="flex items-center gap-2">
        <ChipStrip className="mr-0 min-w-0 flex-1 pr-0">
          <ToggleChip on={day === null} onClick={() => setDay(null)} className="hidden lg:inline-flex">
            Week
          </ToggleChip>
          {days.map((iso) => (
            <ToggleChip
              key={iso}
              on={day === iso}
              count={dayFixtures(iso) + daySessions(iso)}
              onClick={() => setDay(iso)}
            >
              {dayChips[iso] ?? iso}
            </ToggleChip>
          ))}
        </ChipStrip>
        {canManage && cardCount > 0 ? (
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

      {/* Ticking several and pressing one button is what the manage-matches
          disclosure was for. The sheet's forms have always been bulk, so this
          is the same post with more ids in it. */}
      {selecting && canManage ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            {selected.size === 0
              ? "Tap the matches you want — one sheet then acts on all of them."
              : `${selected.size} ticked — cancel, delete or set one kick-off for the lot.`}
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
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="touch"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `minmax(92px, 132px) repeat(${shownDays.length}, minmax(150px, 1fr))`,
          }}
        >
          <div className="sticky left-0 z-10 border-b bg-card" />
          {shownDays.map((iso) => (
            <div key={iso} className="border-b border-l px-3 py-2 text-list font-semibold">
              {dayChips[iso] ?? iso}
              <span className="ml-1.5 font-normal text-muted-foreground">
                {dayFixtures(iso) + daySessions(iso) || ""}
              </span>
            </div>
          ))}

          {/* --------------------------------------------------- matches */}
          <RowHead
            title="Matches"
            note={
              fixtureRow && fixtureRow.needsPitch > 0
                ? `${fixtureRow.needsPitch} without a pitch`
                : team.centralVenueName
                  ? "Plays centrally"
                  : null
            }
            tone={fixtureRow && fixtureRow.needsPitch > 0 ? "warning" : "muted"}
          />
          {shownDays.map((iso) => (
            <div key={iso} className="flex flex-col gap-1.5 border-b border-l p-1.5">
              {(fixtureRow?.byDay[iso] ?? []).map((card) => (
                <MatchCard
                  key={card.id}
                  card={card}
                  selecting={selecting}
                  ticked={selected.has(card.id)}
                  open={sheet?.ids.length === 1 && sheet.ids[0] === card.id}
                  canAllocate={canAllocate}
                  onOpen={openCard}
                  onPlace={(pick) => setSheet({ ids: [pick.id], mode: "pitch" })}
                />
              ))}
            </div>
          ))}

          {/* -------------------------------------------------- training */}
          <RowHead
            title="Training"
            note={
              sessionRow && sessionRow.unmarked > 0
                ? `${sessionRow.unmarked} register${sessionRow.unmarked === 1 ? "" : "s"} to take`
                : null
            }
            tone="muted"
          />
          {shownDays.map((iso) => (
            <div key={iso} className="flex flex-col gap-1.5 border-b border-l p-1.5">
              {(sessionRow?.byDay[iso] ?? []).map((card) => (
                <SessionTile
                  key={card.bookingId}
                  card={card}
                  today={today}
                  href={`/pitches/${card.bookingId}`}
                />
              ))}
              {/* The empty evening is the point of the fixed columns. */}
              <Link
                href={`/pitches/book?team=${encodeURIComponent(team.id)}&date=${iso}`}
                aria-label={`Book a pitch for ${team.name} on ${dayLabels[iso] ?? iso}`}
                title="Book a pitch here"
                className={
                  "touch inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition-opacity hover:border-primary/50 hover:text-primary lg:min-h-[28px] " +
                  ((sessionRow?.byDay[iso] ?? []).length === 0
                    ? "opacity-70"
                    : "opacity-40 hover:opacity-100 focus-visible:opacity-100")
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {(sessionRow?.byDay[iso] ?? []).length === 0 ? "Book a pitch" : null}
              </Link>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {canManage
          ? "Tap a match for its kick-off, its pitch and the four things an administrator does to it. Fixtures arrive from the FA importer — the Settings tab is where that link lives."
          : "Tap a match for who is coming. Fixtures arrive from the FA importer."}
        {" "}
        Seven days here; every coming kick-off is folded beneath.
      </p>

      <FixtureSheet
        open={sheet !== null}
        fixtures={sheetFixtures}
        mode={sheet?.mode ?? "view"}
        onMode={(mode) => setSheet((current) => (current ? { ...current, mode } : current))}
        onClose={() => setSheet(null)}
        canManage={canManage}
        pitches={pitches}
        from={`/teams/${team.id}`}
        onDone={() => {
          setSelected(new Set());
          setSheet(null);
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// The two row headers, and the two cards
// ---------------------------------------------------------------------------

function RowHead({
  title,
  note,
  tone,
}: {
  title: string;
  note: string | null;
  tone: "warning" | "muted";
}) {
  return (
    <div className="sticky left-0 z-10 border-b bg-card px-3 py-2.5">
      <p className="text-list font-semibold leading-tight">{title}</p>
      {note ? (
        <p className={`text-2xs ${tone === "warning" ? "text-warning" : "text-muted-foreground"}`}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** The fixture card `/matches` draws, on a team's own week. */
function MatchCard({
  card,
  selecting,
  ticked,
  open,
  canAllocate,
  onOpen,
  onPlace,
}: {
  card: FixtureCard;
  selecting: boolean;
  ticked: boolean;
  open: boolean;
  canAllocate: boolean;
  onOpen: (card: FixtureCard) => void;
  onPlace: (card: FixtureCard) => void;
}) {
  const short = card.replies.total > 0 && card.replies.in * 2 < card.replies.total;
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
        (card.status === "cancelled" ? " opacity-70" : "")
      }
    >
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

/** The session card `/training` draws; here it is a door to the register. */
function SessionTile({
  card,
  today,
  href,
}: {
  card: SessionCard;
  today: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${dayWord(card.dayIso, card.time, today)} ${card.time} at ${card.pitch} — ${card.attendance} coming, register ${card.marked ? "taken" : "not taken"}`}
      className={
        "touch block w-full rounded-lg border p-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        (card.marked
          ? "border-success/30 bg-success-tint hover:border-success/60"
          : "border-border bg-card hover:border-primary/50")
      }
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-list font-semibold">{card.time}</span>
        <Badge variant={card.accepted > 0 ? "success" : "muted"} className="px-1.5 text-2xs">
          {card.attendance}
        </Badge>
      </div>
      <p className="mt-0.5 truncate text-2xs text-muted-foreground">{card.pitch}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Badge variant={card.marked ? "success" : "muted"} className="px-1.5 text-2xs">
          {card.marked ? "marked" : "not taken"}
        </Badge>
        {card.awaitingPitch ? (
          <Badge variant="warning" className="px-1.5 text-2xs">
            pitch awaiting confirmation
          </Badge>
        ) : null}
      </div>
    </Link>
  );
}
