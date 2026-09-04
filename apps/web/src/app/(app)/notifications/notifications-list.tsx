"use client";

/**
 * The feed (gap 5).
 *
 * A notification with a link is a submit button wrapping the whole row: the
 * server action marks it read and then redirects, so "clicked it" and "read
 * it" are one atomic thing rather than two racing fetches. One without a link
 * gets a plain "Mark read" button instead — the same RPC, no navigation.
 *
 * Unread rows are styled, not merely dotted: the accent bar and the weight
 * change survive both themes and do not rely on colour alone.
 */

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  absoluteTime,
  relativeTime,
  type NotificationItem,
} from "@/lib/notifications";

import {
  markAllNotificationsRead,
  markNotificationRead,
  openNotification,
  type NotificationActionState,
} from "./actions";

/** `"use server"` modules may export only async functions, so this lives here. */
const EMPTY_NOTIFICATION_STATE: NotificationActionState = {};

function Feedback({ state }: { state: NotificationActionState }) {
  if (state.error) {
    return (
      <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function MarkAllReadButton({ unread }: { unread: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    markAllNotificationsRead,
    EMPTY_NOTIFICATION_STATE,
  );
  // The badge in the shell is server-rendered; revalidatePath alone left it
  // showing the old count on the page the button was pressed from (Adam,
  // 2026-09-04: "when I click on 'Read All' they don't disappear"). A refresh
  // re-renders the layout with the database's answer.
  useEffect(() => {
    if (state.notice) router.refresh();
  }, [state.notice, router]);
  return (
    <div className="space-y-2">
      <form action={action}>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pending || unread === 0}
          className="min-h-[44px] lg:min-h-0"
        >
          <CheckCheck className="h-4 w-4" /> Mark all read
        </Button>
      </form>
      <Feedback state={state} />
    </div>
  );
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    markNotificationRead,
    EMPTY_NOTIFICATION_STATE,
  );
  // Same as Mark all read: the shell's badge only moves with a refresh.
  useEffect(() => {
    if (state.notice) router.refresh();
  }, [state.notice, router]);
  const unread = item.readAt === null;

  const summary = (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={unread ? "text-sm font-semibold" : "text-sm font-medium"}>
          {item.subject}
        </span>
        {unread && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            New
          </span>
        )}
      </div>
      {item.body && (
        <p className="whitespace-pre-line text-sm text-muted-foreground">{item.body}</p>
      )}
      <p className="text-xs text-muted-foreground" title={absoluteTime(item.createdAt)}>
        {relativeTime(item.createdAt)}
      </p>
    </>
  );

  return (
    <li
      className={
        // A phone gets a tappable card per notification; the desk keeps the
        // divided list it has always had.
        "rounded-xl border-y border-r border-l-2 px-3 py-3 lg:rounded-none lg:border-y-0 " +
        "lg:border-r-0 lg:py-4 " +
        (unread ? "border-l-primary bg-primary/5" : "border-l-border lg:border-l-transparent")
      }
    >
      {item.link ? (
        <form action={openNotification}>
          <input type="hidden" name="notification_id" value={item.id} />
          <input type="hidden" name="link" value={item.link} />
          <button
            type="submit"
            className="flex min-h-[44px] w-full items-start justify-between gap-3 text-left hover:opacity-80 lg:min-h-0"
          >
            <span className="min-w-0 space-y-1">{summary}</span>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </form>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">{summary}</div>
          {unread && (
            <form action={action}>
              <input type="hidden" name="notification_id" value={item.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={pending}
                className="min-h-[44px] lg:min-h-0"
              >
                Mark read
              </Button>
            </form>
          )}
          <Feedback state={state} />
        </div>
      )}
    </li>
  );
}

export function NotificationsList({ items }: { items: NotificationItem[] }) {
  if (items.length === 0) {
    return (
      <div className="space-y-2 py-10 text-center">
        <Bell className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Nothing yet. The club will tell you here when a request is decided, a booking is
          confirmed, or you are added to a team.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2 py-1 lg:space-y-0 lg:divide-y lg:py-0">
      {items.map((item) => (
        <NotificationRow key={item.id} item={item} />
      ))}
    </ul>
  );
}
