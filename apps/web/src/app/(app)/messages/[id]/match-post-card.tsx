"use client";

/**
 * The "game needs a referee" card (Adam, 2026-08-25, from his WhatsApp
 * screenshot — "but use better icons"): the posted details as icon rows, and
 * a Claim button an approved referee can press once. A claimed card says who
 * got the game — and (Adam, later that evening: "refs and coaches can remove
 * their claim to a game and it reopens it") offers Release to the referee who
 * holds it, to the coach who posted it, and to a club admin. Released, the
 * card is Referee needed again.
 *
 * NO SUCCESS NOTICES. Adam, 2026-08-25: after releasing a game the card said
 * "Game claimed — the poster has your contact details", and when the next
 * referee claimed it, "The game is open again". Both were true when they were
 * written and stale by the time they were read: a `useActionState` notice
 * outlives the action, and this card flips between its two branches as the
 * game changes hands, so each branch was showing the OTHER action's old
 * message. The card itself is the feedback — "Referee obtained — Rita Ref", or
 * the Claim button coming back — so only refusals are rendered, and those are
 * about the attempt in front of you.
 */

import { useActionState } from "react";
import {
  BadgeCheck,
  Banknote,
  CalendarClock,
  Layers,
  Loader2,
  MapPin,
  Timer,
  Trophy,
  UserCheck,
  UserMinus,
} from "lucide-react";

import { claimMatchGame, releaseMatchGame, type RefereeActionState } from "./referee-actions";
import type { MatchPostView } from "./thread-data";

const EMPTY: RefereeActionState = {};

function kickoffLabel(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time = at.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${day}, ${time} KO`;
}

export function MatchPostCard({
  post,
  isReferee,
  myPersonId,
  isAdmin,
}: {
  post: MatchPostView;
  isReferee: boolean;
  myPersonId: string | null;
  isAdmin: boolean;
}) {
  const [state, action, claiming] = useActionState(claimMatchGame, EMPTY);
  const [releaseState, releaseAction, releasing] = useActionState(releaseMatchGame, EMPTY);

  const rows: { icon: typeof Trophy; text: string }[] = [
    { icon: Trophy, text: post.fixtureText },
    ...(post.durationText || post.formatText
      ? [
          {
            icon: Timer,
            text: [post.durationText, post.formatText].filter(Boolean).join(" · "),
          },
        ]
      : []),
    ...(post.locationText ? [{ icon: MapPin, text: post.locationText }] : []),
    ...(post.surface ? [{ icon: Layers, text: post.surface }] : []),
    ...(post.kickoffAt ? [{ icon: CalendarClock, text: kickoffLabel(post.kickoffAt) }] : []),
    ...(post.feeText ? [{ icon: Banknote, text: post.feeText }] : []),
  ];

  // Who may hand the game back — mirrors the guard trigger, so the button is
  // never offered to someone the database would refuse.
  const canRelease =
    !!post.claimedByName &&
    !!myPersonId &&
    (myPersonId === post.claimedByPersonId || myPersonId === post.postedByPersonId || isAdmin);
  const releaseLabel = myPersonId === post.claimedByPersonId ? "I can't referee this" : "Release game";

  return (
    /* No `min-w`: the card used to insist on 15rem inside a bubble capped at
       75% of a phone, so it overflowed its own bubble rather than fitting it.
       The bubble now gives a card the width of the screen and the card takes
       whatever that is (Adam, 2026-09-01). */
    <div className="min-w-0 rounded-lg border bg-secondary/40 p-2.5">
      <p className="font-display text-[10px] font-medium uppercase tracking-[0.14em] text-primary">
        Referee needed
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {rows.map((row, index) => {
          const Icon = row.icon;
          return (
            <li key={index} className="flex items-start gap-2 text-sm">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className={index === 0 ? "font-medium" : undefined}>{row.text}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-2.5 border-t pt-2">
        {post.claimedByName ? (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden />
              Referee obtained — {post.claimedByName}
            </p>
            {canRelease && (
              <form action={releaseAction}>
                <input type="hidden" name="post_id" value={post.id} />
                <button
                  type="submit"
                  disabled={releasing}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border bg-card px-3 text-xs font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-60 lg:min-h-0 lg:py-1.5"
                >
                  {releasing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <UserMinus className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {releaseLabel}
                </button>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  The game goes back to Referee needed for the next referee to claim.
                </p>
                {releaseState.error && (
                  <p className="mt-1.5 text-xs text-destructive">{releaseState.error}</p>
                )}
              </form>
            )}
          </div>
        ) : isReferee ? (
          <form action={action}>
            <input type="hidden" name="post_id" value={post.id} />
            <button
              type="submit"
              disabled={claiming}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 lg:min-h-0 lg:py-1.5"
            >
              {claiming ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <UserCheck className="h-3.5 w-3.5" aria-hidden />
              )}
              Claim game
            </button>
            {state.error && <p className="mt-1.5 text-xs text-destructive">{state.error}</p>}
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">Waiting for a referee to claim it.</p>
        )}
      </div>
    </div>
  );
}
