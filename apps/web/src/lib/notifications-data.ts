/**
 * In-app notifications — the reads (gap 5).
 *
 * Both queries go through the USER-SCOPED client. Two policies can return an
 * `outbound_messages` row: `outbound_messages_self_read` (can_act_for, so a
 * guardian can see a child's) and `outbound_messages_admin_read` (a club
 * administrator can see the whole club's). The second is right for a comms
 * audit and quite wrong for an inbox, so the feed pins `person_id` to
 * `current_person_id()` — the same person `unread_notification_count()` and
 * `mark_all_notifications_read()` work on. Without that pin an administrator's
 * bell would count every message the club has ever sent.
 */

import {
  toNotificationItem,
  type NotificationItem,
  type NotificationRow,
  NOTIFICATIONS_PAGE_SIZE,
} from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

/**
 * `unread_notification_count()` — the bell's badge.
 *
 * SECURITY DEFINER and scoped to `current_person_id()`, so it is safe to ask
 * for any signed-in user and returns 0 for a sign-in with no member record.
 */
export async function loadUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unread_notification_count");
  if (error) return 0;
  return data ?? 0;
}

export type NotificationPage = {
  items: NotificationItem[];
  /** Total rows in the feed, so the pager knows whether there is a next page. */
  total: number;
  page: number;
  pageCount: number;
  unread: number;
  /** Null when the sign-in is not linked to a member record. */
  personId: string | null;
  error: string | null;
};

/** Newest first, 50 to a page. Page numbers are 1-based. */
export async function loadNotifications(page: number): Promise<NotificationPage> {
  const supabase = await createClient();
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;

  const [personResult, unreadResult] = await Promise.all([
    supabase.rpc("current_person_id"),
    supabase.rpc("unread_notification_count"),
  ]);
  const personId = personResult.data ?? null;
  const unread = unreadResult.data ?? 0;

  if (!personId) {
    return { items: [], total: 0, page: 1, pageCount: 1, unread: 0, personId: null, error: null };
  }

  const from = (safePage - 1) * NOTIFICATIONS_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("outbound_messages")
    .select("id,subject,body,link,created_at,read_at,entity,entity_id,person_id,channel", {
      count: "exact",
    })
    .eq("channel", "in_app")
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .range(from, from + NOTIFICATIONS_PAGE_SIZE - 1);

  if (error) {
    return {
      items: [],
      total: 0,
      page: safePage,
      pageCount: 1,
      unread,
      personId,
      error: error.message,
    };
  }

  const total = count ?? 0;
  return {
    items: (data ?? []).map((row) => toNotificationItem(row as NotificationRow)),
    total,
    page: safePage,
    pageCount: Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE)),
    unread,
    personId,
    error: null,
  };
}
