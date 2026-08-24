/**
 * Vocabulary and parsing shared by the events pages. Deliberately not a
 * "use server" file — these are plain values and pure functions.
 */

import type { Json } from "@club/db";

export const EVENT_TYPE_LABELS: Record<string, string> = {
  league_match: "League Match",
  cup_match: "Cup Match",
  friendly: "Friendly",
  practice: "Practice",
  social: "Social",
};

export const EVENT_TYPES = ["league_match", "cup_match", "friendly", "practice", "social"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

/** "Sat 12 Sep 2026" — Europe/London, whatever the server's clock is. */
export function formatEventDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

/** "10:30" — Europe/London. */
export function formatEventTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

/** A Google Maps search for the venue, as Adam asked for on the event page. */
export function googleMapsUrl(venue: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
}

/** One person the viewer answers for, as `my_events().people` carries them. */
export type EventPerson = {
  personId: string;
  name: string;
  isSelf: boolean;
  response: "accepted" | "declined" | null;
};

/** `my_events().people` is jsonb built by the function; read it defensively. */
export function parseEventPeople(value: Json | null | undefined): EventPerson[] {
  if (!Array.isArray(value)) return [];
  const out: EventPerson[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, Json | undefined>;
    const personId = record["person_id"];
    const name = record["name"];
    if (typeof personId !== "string" || typeof name !== "string") continue;
    const response = record["response"];
    out.push({
      personId,
      name,
      isSelf: record["is_self"] === true,
      response: response === "accepted" || response === "declined" ? response : null,
    });
  }
  return out;
}
