/**
 * The squad grid's labels and its three counters.
 *
 * The Squad tab draws a card per member (design: "Club CRM — Sidebar build",
 * Squad tab). Everything a card says has to be TRUE of the club's own data, so
 * the translation from a row to a phrase lives here, on its own, where it can
 * be tested without a database or a browser.
 *
 * Nothing here reads anything or decides who may see it. Whether the caller
 * gets an availability row or a subscription row at all is settled upstream by
 * RLS and by the page's own committee gate; an absent value simply renders as
 * "not asked", never as a guess.
 */

/** An `availability.status` value, or null where nobody has answered yet. */
export type AvailabilityStatus = "available" | "unavailable" | "maybe" | null;

/** How a value reads: green, amber, red, or nothing in particular. */
export type SquadTone = "good" | "warn" | "bad" | "plain";

export type SquadCell = { label: string; tone: SquadTone };

/**
 * The "Saturday" row. A missing answer is amber, not red: nobody has said no,
 * they have said nothing, and that is the difference the coach is chasing.
 */
export function availabilityCell(status: AvailabilityStatus): SquadCell {
  if (status === "available") return { label: "Available", tone: "good" };
  if (status === "unavailable") return { label: "Away", tone: "bad" };
  if (status === "maybe") return { label: "Maybe", tone: "warn" };
  return { label: "No reply", tone: "warn" };
}

/** The newest `subscriptions` row for a player, as the Subs tab reads it. */
export type SquadSub = { status: string | null; amountDuePence: number | null };

/** "£45.00" — pence as the club writes money. */
function pounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * The "Subs" row. Only ever rendered for a committee reader — the page does
 * not load subscriptions for anyone else — so an undefined sub here means "no
 * subscription on record", which is a fact worth showing, not a blank.
 */
export function subsCell(sub: SquadSub | undefined | null): SquadCell {
  if (!sub || sub.status === null) return { label: "No subscription", tone: "plain" };
  if (sub.status === "past_due") {
    return {
      label: sub.amountDuePence !== null ? `${pounds(sub.amountDuePence)} owing` : "Owing",
      tone: "warn",
    };
  }
  if (sub.status === "completed") return { label: "Paid", tone: "good" };
  if (sub.status === "active") return { label: "On plan", tone: "good" };
  if (sub.status === "cancelled") return { label: "Cancelled", tone: "plain" };
  return { label: "Pending", tone: "plain" };
}

/** The chip strip's three filters. */
export type SquadFilter = "all" | "chasing" | "no-contact";

/**
 * What the counters need to know about one card. `availability` is undefined
 * when the question was never asked — no fixture ahead, or a member who is not
 * a player — and null when it was asked and nobody answered.
 */
export type SquadCardFacts = {
  personId: string;
  hasEmergencyContact: boolean;
  availability?: AvailabilityStatus;
};

/** No reply for the next match, or nobody to ring if something happens. */
export function needsChasing(card: SquadCardFacts): boolean {
  const silent = card.availability === null;
  return silent || !card.hasEmergencyContact;
}

export function squadCounts(cards: SquadCardFacts[]): {
  all: number;
  chasing: number;
  noContact: number;
} {
  return {
    all: cards.length,
    chasing: cards.filter(needsChasing).length,
    noContact: cards.filter((card) => !card.hasEmergencyContact).length,
  };
}

export function matchesFilter(card: SquadCardFacts, filter: SquadFilter): boolean {
  if (filter === "chasing") return needsChasing(card);
  if (filter === "no-contact") return !card.hasEmergencyContact;
  return true;
}

/** "Sat 29 Aug, 09:30" — the date the availability column is speaking about. */
export function fixtureWhenLabel(kickoffAt: string): string {
  const at = new Date(kickoffAt);
  if (Number.isNaN(at.getTime())) return "";
  const date = at.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = at.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${date}, ${time}`;
}

/** "Saturday" — the row label on each card, so the value needs no date. */
export function fixtureDayLabel(kickoffAt: string): string {
  const at = new Date(kickoffAt);
  if (Number.isNaN(at.getTime())) return "Next match";
  return at.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long" });
}
