import Link from "next/link";
import { Bell, CalendarRange } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { loadUnreadNotificationCount } from "@/lib/notifications-data";
import { canViewPitchCalendar } from "@/lib/pitch-calendar-data";

/**
 * The two things the app chrome carries that are not a section of the nav:
 * the notifications bell (gap 5) and the pitch calendar link (gap 6).
 *
 * They live in one component so the `(app)` layout gains a single import and a
 * single element — the nav lists themselves are being reorganised elsewhere,
 * and this deliberately stays out of their way.
 *
 * Both questions are the database's. `unread_notification_count()` is scoped to
 * `current_person_id()`, and `can_view_pitch_calendar()` is the same predicate
 * `pitch_calendar()` itself enforces — so the link is offered exactly to the
 * people who would get rows from it, and to nobody else.
 *
 * The count is server-rendered. It refreshes when the layout re-renders, which
 * is every navigation; there is no polling and no client subscription.
 */
export async function HeaderTools() {
  const [unread, canSeeCalendar] = await Promise.all([
    loadUnreadNotificationCount(),
    canViewPitchCalendar(),
  ]);

  return (
    <div className="flex flex-col gap-0.5">
      <Link
        href="/notifications"
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications, none unread"
        }
        className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
      >
        <span className="relative flex h-4 w-4 items-center justify-center">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
          )}
        </span>
        <span>Notifications</span>
        {unread > 0 && (
          <span className="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-semibold leading-none text-destructive-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>

      {canSeeCalendar && (
        <Link
          href="/pitches/calendar"
          className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
        >
          <CalendarRange className="h-4 w-4" /> Pitch calendar
        </Link>
      )}
    </div>
  );
}
