/**
 * In-app notifications — the shared vocabulary (gap 5).
 *
 * The store is `outbound_messages` with `channel = 'in_app'`: P4.4 already made
 * the row *be* the message, and migration 20260824160000_notifications added
 * the two columns a feed needs (`read_at`, `link`), the writers that populate
 * it, and three reader functions — `unread_notification_count()`,
 * `mark_notification_read(id)` and `mark_all_notifications_read()`.
 *
 * This module holds the half both sides of the wire need: the row shape, the
 * link check and the Europe/London formatting. It deliberately imports nothing
 * that reaches `next/headers`, so the client feed can render a row without
 * dragging the server Supabase client into the bundle. The reads live in
 * `lib/notifications-data.ts`.
 *
 * Nothing anywhere in gap 5 sends email. The `in_app` channel is the whole of
 * it — the row is the delivery.
 */

import type { Database } from "@club/db";

export type NotificationRow = Database["public"]["Tables"]["outbound_messages"]["Row"];

export type NotificationItem = {
  id: string;
  subject: string;
  body: string | null;
  /** An in-app path, or null. Only same-origin paths survive {@link safeLink}. */
  link: string | null;
  createdAt: string;
  readAt: string | null;
  entity: string | null;
  entityId: string | null;
};

/** One page of the feed. 50 is the page size the screen paginates by. */
export const NOTIFICATIONS_PAGE_SIZE = 50;

/**
 * A link is followed only if it is a path on this app.
 *
 * The links are written by database triggers, not by users, but a redirect
 * target is exactly the sort of value that should never be trusted on the way
 * out: anything that is not a single-slash relative path is dropped rather
 * than sanitised.
 */
export function safeLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  return value;
}

export function toNotificationItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    subject: row.subject?.trim() || "Notification",
    body: row.body,
    link: safeLink(row.link),
    createdAt: row.created_at,
    readAt: row.read_at,
    entity: row.entity,
    entityId: row.entity_id,
  };
}

/** "2 minutes ago", "3 days ago" — the age a feed shows beside each row. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** "Sat, 1 Mar 2026 · 18:04" in Europe/London — the exact time, on hover. */
export function absoluteTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}
