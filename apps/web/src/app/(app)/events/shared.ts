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
  /** The answer was given before the event's details last changed. */
  stale: boolean;
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
      stale: record["stale"] === true,
    });
  }
  return out;
}

/**
 * Badge styling for an accept/decline response. Lives here — NOT in the
 * "use client" respond-buttons module — because the server-rendered event
 * detail page calls it too, and a function exported from a client module is a
 * client reference the server cannot invoke (the /events/[id] 500 of
 * 2026-08-24, digest 1259262124).
 */
export function responseVariant(
  response: "accepted" | "declined" | null,
): "success" | "destructive" | "muted" {
  if (response === "accepted") return "success";
  if (response === "declined") return "destructive";
  return "muted";
}

export function responseLabel(response: "accepted" | "declined" | null): string {
  if (response === "accepted") return "Accepted";
  if (response === "declined") return "Declined";
  return "No response";
}
