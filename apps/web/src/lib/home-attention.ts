/**
 * "What needs my attention" — the Home screen's first list (P7.2). Pure:
 * takes the database's answers and returns the rows to draw, so the ordering
 * and the wording are testable without a database. The server half that
 * gathers the inputs is `home-attention-server.ts`.
 *
 * The rule for what earns a row: something the PERSON can do something about,
 * right now, with one tap that opens the exact task. A row disappears the
 * moment the thing is done — an answered event, a paid charge, a read thread —
 * because every input is re-read on each render, not remembered.
 */

import type { EventPerson } from "@/app/(app)/events/shared";

export type AttentionEvent = {
  eventId: string;
  title: string;
  teamName: string;
  startsAt: string;
  status: string;
  /** From `my_events().people` — the household members the caller answers for. */
  people: EventPerson[];
};

export type AttentionInputs = {
  now: number;
  events: AttentionEvent[];
  /** Pence still owed across the household's pending charges, net of refunds. */
  outstandingPence: number;
  unreadMessages: number;
  /** Admin queues — zero for everyone who is not a club administrator. */
  approvals: number;
  registrations: number;
};

export type AttentionItem = {
  key: string;
  kind: "respond" | "pay" | "messages" | "approvals" | "registrations";
  title: string;
  detail: string;
  href: string;
  count?: number;
  /** For a respond row: the event and the people still to answer. */
  event?: AttentionEvent;
};

/** Events still to come, soonest first, cancelled ones set aside. */
export function upcomingEvents(events: AttentionEvent[], now: number): AttentionEvent[] {
  return events
    .filter((event) => event.status !== "cancelled" && new Date(event.startsAt).getTime() >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** The next thing in the diary, answered or not. */
export function nextEvent(events: AttentionEvent[], now: number): AttentionEvent | null {
  return upcomingEvents(events, now)[0] ?? null;
}

/** Events where somebody the caller answers for has not replied, or replied before a change. */
export function eventsAwaitingReply(events: AttentionEvent[], now: number): AttentionEvent[] {
  return upcomingEvents(events, now).filter((event) =>
    event.people.some((person) => person.response === null || person.stale),
  );
}

function names(people: EventPerson[]): string {
  const waiting = people.filter((person) => person.response === null || person.stale);
  const labels = waiting.map((person) => (person.isSelf ? "you" : person.name));
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** "£42.50" from pence, the way the rest of the app prints money. */
export function poundsLabel(pence: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

/** How many rows Home shows before pointing at the full list. */
export const ATTENTION_EVENT_LIMIT = 3;

/**
 * The list, in the order a person would want it: the replies the team is
 * waiting for (soonest first), then money, then unread messages, then the
 * administrator's queues. Empty when nothing is waiting — Home says so.
 */
export function attentionItems(input: AttentionInputs): AttentionItem[] {
  const items: AttentionItem[] = [];

  const awaiting = eventsAwaitingReply(input.events, input.now);
  for (const event of awaiting.slice(0, ATTENTION_EVENT_LIMIT)) {
    items.push({
      key: `respond:${event.eventId}`,
      kind: "respond",
      title: `Reply for ${names(event.people)}`,
      detail: `${event.title} · ${event.teamName}`,
      href: `/events/${event.eventId}`,
      event,
    });
  }
  if (awaiting.length > ATTENTION_EVENT_LIMIT) {
    items.push({
      key: "respond:more",
      kind: "respond",
      title: `${awaiting.length - ATTENTION_EVENT_LIMIT} more to reply to`,
      detail: "Everything waiting for an answer, in date order",
      href: "/events",
      count: awaiting.length - ATTENTION_EVENT_LIMIT,
    });
  }

  if (input.outstandingPence > 0) {
    items.push({
      key: "pay",
      kind: "pay",
      title: `${poundsLabel(input.outstandingPence)} to pay`,
      detail: "Subs and charges for your household — pay online",
      href: "/my-payments",
    });
  }

  if (input.unreadMessages > 0) {
    items.push({
      key: "messages",
      kind: "messages",
      title: `${input.unreadMessages} unread message${input.unreadMessages === 1 ? "" : "s"}`,
      detail: "Direct messages, team rooms and announcements",
      href: "/messages?filter=unread",
      count: input.unreadMessages,
    });
  }

  if (input.registrations > 0) {
    items.push({
      key: "registrations",
      kind: "registrations",
      title: `${input.registrations} registration${input.registrations === 1 ? "" : "s"} to review`,
      detail: "Club administration",
      href: "/context?view=admin&next=%2Fregistrations",
      count: input.registrations,
    });
  }
  if (input.approvals > 0) {
    items.push({
      key: "approvals",
      kind: "approvals",
      title: `${input.approvals} approval${input.approvals === 1 ? "" : "s"} waiting`,
      detail: "Role requests and players leaving — club administration",
      href: "/context?view=admin&next=%2Fapprovals",
      count: input.approvals,
    });
  }

  return items;
}
