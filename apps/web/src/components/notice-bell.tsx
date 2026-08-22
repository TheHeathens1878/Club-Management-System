"use client";

import { useState, useEffect, useRef } from "react";
import { Bell, CalendarDays } from "lucide-react";
import { formatDistanceToNow, format, isToday, isTomorrow, isThisWeek } from "date-fns";

type NoticePost = {
  id: string;
  title: string;
  created_at: string;
  pinned: boolean;
};

type UpcomingEvent = {
  id: string;
  title: string;
  start_at: string;
  location: string | null;
  created_at: string;
};

const STORAGE_KEY = "noticeboard_last_seen";

function formatEventWhen(start_at: string): string {
  const d = new Date(start_at);
  if (isToday(d)) return `Today · ${format(d, "h:mm a")}`;
  if (isTomorrow(d)) return `Tomorrow · ${format(d, "h:mm a")}`;
  if (isThisWeek(d, { weekStartsOn: 1 })) return format(d, "EEEE · h:mm a");
  return format(d, "d MMM · h:mm a");
}

export function NoticeBell({
  posts,
  events = [],
  fixed,
}: {
  posts: NoticePost[];
  events?: UpcomingEvent[];
  fixed?: boolean;
}) {
  const [lastSeen, setLastSeen] = useState<number>(Date.now());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setLastSeen(stored ? Number(stored) : 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const newPosts = posts.filter((p) => new Date(p.created_at).getTime() > lastSeen).length;
  const newEvents = events.filter((e) => new Date(e.created_at).getTime() > lastSeen).length;
  const count = newPosts + newEvents;

  function handleOpen() {
    setOpen((o) => !o);
    if (!open) {
      const now = Date.now();
      localStorage.setItem(STORAGE_KEY, String(now));
      setLastSeen(now);
    }
  }

  const dropdownClass = fixed
    ? "fixed top-14 right-3 z-[60] w-80 rounded-xl border bg-card shadow-lg"
    : "absolute left-0 bottom-full z-50 mb-1 w-80 rounded-xl border bg-card shadow-lg";

  const hasContent = posts.length > 0 || events.length > 0;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={handleOpen}
        className="relative flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        aria-label={count > 0 ? `${count} new notification${count !== 1 ? "s" : ""}` : "Notifications"}
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className={dropdownClass}>
          {!hasContent ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing to show yet.</p>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              {/* Upcoming events */}
              {events.length > 0 && (
                <>
                  <div className="sticky top-0 border-b bg-card px-4 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <CalendarDays className="h-3 w-3" />
                      Upcoming events
                    </p>
                  </div>
                  <ul className="divide-y">
                    {events.map((ev) => {
                      const isNew = new Date(ev.created_at).getTime() > lastSeen;
                      return (
                        <li key={ev.id}>
                          <a
                            href={`/events/${ev.id}`}
                            onClick={() => setOpen(false)}
                            className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                          >
                            <div className="mt-0.5 flex-1 min-w-0">
                              <p className={`text-sm leading-snug truncate ${isNew ? "font-semibold text-foreground" : "text-foreground/80"}`}>
                                {ev.title}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {formatEventWhen(ev.start_at)}
                                {ev.location && ` · ${ev.location}`}
                              </p>
                            </div>
                            {isNew && (
                              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                            )}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {/* Noticeboard */}
              {posts.length > 0 && (
                <>
                  <div className="sticky top-0 border-b bg-card px-4 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Bell className="h-3 w-3" />
                      Announcements
                    </p>
                  </div>
                  <ul className="divide-y">
                    {posts.map((post) => {
                      const isNew = new Date(post.created_at).getTime() > lastSeen;
                      return (
                        <li key={post.id}>
                          <a
                            href={`/noticeboard#${post.id}`}
                            onClick={() => setOpen(false)}
                            className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                          >
                            <div className="mt-0.5 flex-1 min-w-0">
                              <p className={`text-sm leading-snug truncate ${isNew ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                                {post.pinned ? "📌 " : ""}{post.title}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                              </p>
                            </div>
                            {isNew && (
                              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                            )}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t px-4 py-2.5">
            <a
              href="/noticeboard"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-primary hover:underline"
            >
              All announcements →
            </a>
            <a
              href="/events"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-primary hover:underline"
            >
              All events →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
