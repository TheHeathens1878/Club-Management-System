import Link from "next/link";
import { CalendarCheck, ChevronRight, ClipboardCheck, MessageSquare, Receipt, UserCheck } from "lucide-react";

import { RespondButtons } from "@/app/(app)/events/respond-buttons";
import { formatEventDate, formatEventTime } from "@/app/(app)/events/shared";
import { loadHomeAttention } from "@/lib/home-attention-server";
import type { AttentionItem } from "@/lib/home-attention";

const ICONS: Record<AttentionItem["kind"], typeof Receipt> = {
  respond: CalendarCheck,
  pay: Receipt,
  messages: MessageSquare,
  approvals: UserCheck,
  registrations: ClipboardCheck,
};

/**
 * "Needs your attention" (P7.2) — and, when nothing does, the next thing in
 * the diary, so Home always answers "what's next" even on a quiet week.
 *
 * A reply row carries the accept/decline buttons inline: the commonest task
 * in the club — a parent saying whether their child is playing on Saturday —
 * is done from the first screen, and the row is gone on the next render.
 */
export async function HomeAttention() {
  const { items, next } = await loadHomeAttention();

  if (items.length === 0 && !next) return null;

  return (
    <section aria-labelledby="attention-heading" className="px-4 pt-4 lg:px-6">
      <h2
        id="attention-heading"
        className="font-display mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground"
      >
        {items.length > 0 ? "Needs your attention" : "Next up"}
      </h2>

      {items.length === 0 && next ? (
        <Link
          href={`/events/${next.eventId}`}
          className="flex min-h-[52px] items-center gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-secondary/50"
        >
          <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarCheck className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium leading-snug">
              {next.title} · {next.teamName}
            </span>
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
              {formatEventDate(next.startsAt)} · {formatEventTime(next.startsAt)} — everyone has replied
            </span>
          </span>
          <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
        </Link>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {items.map((item) => {
            const Icon = ICONS[item.kind];
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 hover:bg-secondary/50"
                >
                  <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-accent/15 text-accent">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium leading-snug">{item.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
                      {item.event
                        ? `${item.detail} · ${formatEventDate(item.event.startsAt)} ${formatEventTime(item.event.startsAt)}`
                        : item.detail}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                </Link>
                {item.event ? (
                  <div className="px-4 pb-3">
                    <RespondButtons eventId={item.event.eventId} people={item.event.people} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
