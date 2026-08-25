"use client";

/**
 * The "game needs a referee" card (Adam, 2026-08-25, from his WhatsApp
 * screenshot — "but use better icons"): the posted details as icon rows, and
 * a Claim button an approved referee can press once. A claimed card says who
 * got the game.
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
} from "lucide-react";

import { claimMatchGame, type RefereeActionState } from "./referee-actions";
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

export function MatchPostCard({ post, isReferee }: { post: MatchPostView; isReferee: boolean }) {
  const [state, action, claiming] = useActionState(claimMatchGame, EMPTY);

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

  return (
    <div className="my-1 min-w-[15rem] rounded-lg border bg-secondary/40 p-2.5">
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
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden />
            Referee obtained — {post.claimedByName}
          </p>
        ) : isReferee ? (
          <form action={action}>
            <input type="hidden" name="post_id" value={post.id} />
            <button
              type="submit"
              disabled={claiming}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {claiming ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <UserCheck className="h-3.5 w-3.5" aria-hidden />
              )}
              Claim game
            </button>
            {state.error && <p className="mt-1.5 text-xs text-destructive">{state.error}</p>}
            {state.notice && <p className="mt-1.5 text-xs text-emerald-700">{state.notice}</p>}
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">Waiting for a referee to claim it.</p>
        )}
      </div>
    </div>
  );
}
