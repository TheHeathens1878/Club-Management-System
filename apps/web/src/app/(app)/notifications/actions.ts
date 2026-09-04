"use server";

/**
 * In-app notifications — the writes (gap 5).
 *
 * There are exactly three, and all three are the database's own functions:
 * `mark_notification_read(id)`, `mark_all_notifications_read()` and — for the
 * "open it" path — the first followed by a redirect. They are SECURITY DEFINER
 * and scoped by `can_act_for` / `current_person_id()`, so the recipient is
 * decided in Postgres and the app never passes a person id in.
 *
 * The user-scoped client is used throughout: the grants on those functions are
 * to `authenticated`, so the caller's own JWT is what identifies them.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { safeLink } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

/**
 * Only async functions and types may be exported from a `"use server"` module,
 * so the empty state this shape starts at lives with the component that uses
 * it — the same split `booking-feedback.tsx` uses for pitch bookings.
 */
export type NotificationActionState = { error?: string; notice?: string };

/** A UUID and nothing else — the id comes from a form field. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readId(formData: FormData): string | null {
  const value = String(formData.get("notification_id") ?? "").trim();
  return UUID_RE.test(value) ? value : null;
}

async function markRead(id: string): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  return error ? error.message : null;
}

/** Mark one read and stay on the feed — for a notification with no link. */
export async function markNotificationRead(
  _prev: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const id = readId(formData);
  if (!id) return { error: "No notification given." };

  const error = await markRead(id);
  if (error) return { error: `Could not mark that as read: ${error}` };

  revalidatePath("/notifications");
  revalidatePath("/", "layout");
  // A notice, not {}: the list's refresh effect keys on it, and the badge in
  // the shell only moves when the layout actually re-renders.
  return { notice: "Marked as read." };
}

/**
 * Open one: mark it read, then go where it points.
 *
 * The redirect happens even when the mark fails — a broken read marker is not
 * a reason to refuse someone the page they clicked. Only a same-origin path is
 * followed; anything else lands back on the feed.
 */
export async function openNotification(formData: FormData): Promise<void> {
  const id = readId(formData);
  if (id) await markRead(id);

  revalidatePath("/notifications");
  revalidatePath("/", "layout");

  const target = safeLink(String(formData.get("link") ?? ""));
  redirect(target ?? "/notifications");
}

/** Everything unread, in one go. Returns how many rows the database changed. */
export async function markAllNotificationsRead(
  _prev: NotificationActionState,
  _formData: FormData,
): Promise<NotificationActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) return { error: `Could not mark them read: ${error.message}` };

  revalidatePath("/notifications");
  revalidatePath("/", "layout");

  const count = data ?? 0;
  if (count === 0) return { notice: "Nothing was unread." };
  return { notice: `${count} notification${count === 1 ? "" : "s"} marked as read.` };
}
