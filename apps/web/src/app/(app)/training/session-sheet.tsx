"use client";

/**
 * One training session, without leaving the week.
 *
 * Taking a register used to be two navigations — the week, then the booking,
 * then find the sheet on it. Here the card opens a drawer (a bottom sheet on a
 * phone) with three modes:
 *
 *   · **register** — the booking's own `AttendancePanel`, the same form and
 *     the same `saveBookingAttendance` as `/pitches/[bookingId]`; a late
 *     arrival still counts as trained, because the panel is unchanged.
 *   · **availability** — who said they are coming, read only. It is the
 *     squad's answer, theirs to change, and the sheet never offers to.
 *   · **view** — when, where, who booked it, and the doors out to the event
 *     and to the booking itself.
 *
 * The roster arrives on OPEN, from `fetchSessionRegister`, and only for the
 * modes that show people: a week of teams is a week of squads, and none of
 * them is worth reading to draw a grid. `canMark` is the page's copy of the
 * register gate — `(staff || admin) && !isMemberView(view)` — and the action
 * asks the database the same question again for itself, so a parent who is
 * also a coach gets no register while the parent hat is on, whichever way in
 * they found.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ClipboardCheck, LandPlot, SquareArrowOutUpRight, UserCheck } from "lucide-react";

import { AVAILABILITY_LABELS, availabilityVariant } from "@/app/(app)/pitches/[bookingId]/availability-panel";
import { AttendancePanel } from "@/app/(app)/pitches/[bookingId]/attendance-panel";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { ChipStrip } from "@/components/ui/chip-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet } from "@/components/ui/sheet";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { dayWord, type SessionCard } from "@/lib/training-week";

import { fetchSessionRegister } from "./register-actions";
import type { SessionMeta, SessionRegister } from "./training-reads";

export type SessionSheetMode = "register" | "availability" | "view";

/** Which session is open, and on which mode. Keyed on the id, not on a row. */
export type SheetState = { bookingId: string; mode: SessionSheetMode };

const MODE_LABELS: Record<SessionSheetMode, string> = {
  register: "Register",
  availability: "Coming",
  view: "Session",
};

export function SessionSheet({
  card,
  meta,
  mode,
  canMark,
  today,
  register,
  onMode,
  onClose,
}: {
  /** The session `state` names, fresh from the page — undefined once it is gone. */
  card: SessionCard | undefined;
  meta?: SessionMeta;
  mode: SessionSheetMode;
  /** The page's answer to "may this person mark a register at all?". */
  canMark: boolean;
  /** Today in London, so the title says "Tonight" the way the bar does. */
  today: string;
  /**
   * A register already in hand. The app never passes one — the sheet fetches
   * its own — but the render harness shims every server action away, so this
   * is how the register is photographed with people on it.
   */
  register?: SessionRegister | null;
  onMode: (mode: SessionSheetMode) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<SessionRegister | null>(register ?? null);
  const [loading, setLoading] = useState(false);
  /** A register was opened, so the "not taken" chips behind may be stale. */
  const marked = useRef(false);

  const bookingId = card?.bookingId ?? null;
  const wantsPeople = mode === "register" || mode === "availability";
  const preloaded = register !== undefined;

  useEffect(() => {
    if (preloaded || !bookingId || !canMark || !wantsPeople) return;
    // Already in hand: switching between Register and Coming re-reads nothing.
    if (loaded?.bookingId === bookingId) return;
    let live = true;
    setLoading(true);
    fetchSessionRegister(bookingId)
      .then((result) => {
        if (!live) return;
        setLoaded(result?.rows ? result : { bookingId, canMark: false, rows: [] });
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [bookingId, canMark, wantsPeople, preloaded, loaded]);

  // A different session means a different roster: drop the one in hand rather
  // than show the last team's names under this team's title.
  useEffect(() => {
    if (preloaded) return;
    setLoaded((current) => (current && current.bookingId === bookingId ? current : null));
  }, [bookingId, preloaded]);

  useEffect(() => {
    if (mode === "register") marked.current = true;
  }, [mode]);

  if (!card) return null;

  const rows = loaded && loaded.bookingId === bookingId ? loaded.rows : [];
  const showing = loaded !== null && loaded.bookingId === bookingId;
  const modes: SessionSheetMode[] = canMark
    ? ["register", "availability", "view"]
    : ["availability", "view"];

  function close() {
    // `saveBookingAttendance` revalidates the booking's own page, not this
    // one, so a register taken here would leave "not taken" on the card until
    // the next visit. Asking for the week again on the way out costs one read
    // and keeps the grid honest.
    if (marked.current) router.refresh();
    marked.current = false;
    onClose();
  }

  return (
    <Sheet
      open
      onClose={close}
      title={`${dayWord(card.dayIso, card.time, today)} ${card.time} · ${card.teamName}`}
      subtitle={`${card.pitch}${meta ? ` · booked by ${meta.bookedBy}` : ""}`}
      side="drawer"
      width={460}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={card.accepted > 0 ? "success" : "muted"}>
            {card.attendance} coming
          </Badge>
          <Badge variant={card.marked ? "success" : "muted"}>
            {card.marked ? "Register taken" : "Register not taken"}
          </Badge>
          {card.awaitingPitch ? <Badge variant="warning">pitch awaiting confirmation</Badge> : null}
        </div>

        {modes.length > 1 ? (
          <ChipStrip>
            {modes.map((option) => (
              <ToggleChip key={option} on={mode === option} onClick={() => onMode(option)}>
                {MODE_LABELS[option]}
              </ToggleChip>
            ))}
          </ChipStrip>
        ) : null}

        {mode === "register" ? (
          !canMark ? (
            <Callout tone="info" icon={<UserCheck className="h-4 w-4" aria-hidden />}>
              The register belongs to the team&apos;s staff. Switch to the Coach or Club admin view
              to mark one.
            </Callout>
          ) : loading && !showing ? (
            <RosterSkeleton />
          ) : rows.length === 0 && showing ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nobody is recorded in the teams on this session, so there is no sheet to mark.
            </p>
          ) : showing ? (
            <AttendancePanel bookingId={card.bookingId} rows={rows} />
          ) : (
            <RosterSkeleton />
          )
        ) : null}

        {mode === "availability" ? (
          <section className="space-y-3">
            <p className="text-sm text-muted-foreground">
              What the squad said. It is theirs to change — on the session itself, or from their own
              diary.
            </p>
            {loading && !showing ? (
              <RosterSkeleton />
            ) : rows.length > 0 ? (
              <ul className="divide-y rounded-xl border">
                {rows.map((row) => (
                  <li key={row.personId} className="touch flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.name}</span>
                      {row.availabilityNote ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.availabilityNote}
                        </span>
                      ) : null}
                    </span>
                    <Badge variant={availabilityVariant(row.availability)}>
                      {row.availability ? AVAILABILITY_LABELS[row.availability] : "No answer"}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {card.squad > 0
                  ? `${card.accepted} of ${card.squad} have said they are coming${card.declined > 0 ? `, and ${card.declined} cannot` : ""}. The names are on the session itself.`
                  : "Nobody is recorded in the teams on this session yet."}
              </p>
            )}
          </section>
        ) : null}

        {mode === "view" ? (
          <dl className="space-y-2 text-sm">
            <Fact label="When">
              {dayWord(card.dayIso, card.time, today)} {card.time}
            </Fact>
            <Fact label="Where">{card.pitch}</Fact>
            <Fact label="Team">{card.teamName}</Fact>
            {meta ? <Fact label="Booked by">{meta.bookedBy}</Fact> : null}
            <Fact label="Coming">
              {card.squad > 0
                ? `${card.accepted} of ${card.squad}${card.declined > 0 ? ` · ${card.declined} cannot` : ""}`
                : "No squad recorded"}
            </Fact>
          </dl>
        ) : null}

        <div className="flex flex-col gap-2 border-t pt-4">
          {card.eventId ? (
            <SheetLink
              href={`/events/${card.eventId}?from=/training`}
              icon={<CalendarDays className="h-4 w-4" aria-hidden />}
            >
              The session in the diary
            </SheetLink>
          ) : null}
          <SheetLink
            href={`/pitches/${card.bookingId}`}
            icon={<ClipboardCheck className="h-4 w-4" aria-hidden />}
          >
            The booking, in full
          </SheetLink>
          {card.awaitingPitch ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <LandPlot className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
              The pitch is booked but not confirmed yet — the session stands, the ground does not.
            </p>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 flex-none text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function SheetLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="touch flex items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-secondary"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <SquareArrowOutUpRight className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** The shape of the sheet that is arriving, not a spinner in the middle of it. */
function RosterSkeleton() {
  return (
    <div aria-busy="true" className="space-y-2">
      <span className="sr-only">Loading the roster…</span>
      {[0, 1, 2, 3, 4].map((n) => (
        <Skeleton key={n} className="h-12 w-full" />
      ))}
    </div>
  );
}
