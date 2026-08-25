"use client";

/**
 * The conversation rail (design build, 2026-08-25): search, the filter pills
 * — All · Teams · Groups · Direct · Unread N — and the list itself. Rows are
 * text-only: name + timestamp, a one-line sender-prefixed preview, then a chip
 * row where an orange count means unread and a muted chip says what the thing
 * is ("46 members" for a group, "Direct" for a DM).
 *
 * The design's "Teams" pill is read as team-bound conversations; the club's
 * other groups keep their own "Groups" pill so the parent menu's "My groups"
 * entry (?filter=groups) still lands somewhere true.
 *
 * Everything arrives serialised from the layout; this component owns only the
 * filtering and the active-row highlight. On a phone the rail is the /messages
 * page itself and hides once a thread is open.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Eye, MessageSquarePlus, Search } from "lucide-react";

import { Input, Label } from "@/components/ui/input";

export type RailItem = {
  id: string;
  name: string;
  /** conversations.type — "team" | "group" | "dm" | "announcement" | … */
  kind: string;
  /** A team room, or a group attached to a team. */
  teamBound: boolean;
  members: number;
  unread: number;
  timeLabel: string;
  preview: string;
  supervised: boolean;
  closed: boolean;
  left: boolean;
};

type Filter = "all" | "teams" | "groups" | "direct" | "unread";

function matchesFilter(item: RailItem, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "teams":
      return item.teamBound;
    case "groups":
      // Adam, 2026-08-25: "Teams are not groups so shouldn't show in there" —
      // anything bound to a team (its room, its announcements, a group
      // attached to it) lives under Teams; Groups is the rest.
      return item.kind === "group" && !item.teamBound;
    case "direct":
      return item.kind === "dm";
    case "unread":
      return item.unread > 0;
  }
}

export function ConversationRail({ items }: { items: RailItem[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(
    searchParams.get("filter") === "groups" ? "groups" : "all",
  );

  const unreadCount = useMemo(() => items.filter((item) => item.unread > 0).length, [items]);
  const needle = query.trim().toLocaleLowerCase("en-GB");
  const shown = items.filter(
    (item) =>
      matchesFilter(item, filter) &&
      (needle === "" || item.name.toLocaleLowerCase("en-GB").includes(needle)),
  );

  const onIndex = pathname === "/messages";
  const pills: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "teams", label: "Teams" },
    { key: "groups", label: "Groups" },
    { key: "direct", label: "Direct" },
    { key: "unread", label: unreadCount > 0 ? `Unread ${unreadCount}` : "Unread" },
  ];

  return (
    <aside
      className={
        "w-full shrink-0 border-r bg-card lg:flex lg:w-80 lg:flex-col " +
        // The rail is the index page on a phone; a thread replaces it.
        (onIndex ? "flex flex-col" : "hidden")
      }
    >
      <div className="border-b px-4 pb-3 pt-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Messages</h2>
          <Link
            href="/messages/new"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title="New message"
          >
            <MessageSquarePlus className="h-4 w-4" />
            <span className="sr-only">New message</span>
          </Link>
        </div>
        <div className="relative mt-3">
          <Label htmlFor="conversation-search" className="sr-only">
            Search conversations
          </Label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="conversation-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            autoComplete="off"
            className="h-8 bg-secondary/50 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5">
        {pills.map((pill) => (
          <button
            key={pill.key}
            type="button"
            onClick={() => setFilter(pill.key)}
            className={
              "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors " +
              (filter === pill.key
                ? "bg-foreground text-background"
                : pill.key === "unread" && unreadCount > 0
                  ? "bg-primary/10 text-primary hover:bg-primary/20"
                  : "bg-secondary text-foreground/80 hover:bg-secondary/70")
            }
          >
            {pill.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {items.length === 0
              ? "No conversations yet. Team rooms appear here automatically once you are on a team."
              : needle !== ""
                ? "No conversation matches that search."
                : "Nothing under this filter."}
          </p>
        ) : (
          shown.map((item) => {
            const href = `/messages/${item.id}`;
            const active = pathname === href;
            return (
              <Link
                key={item.id}
                href={href}
                className={
                  "block border-b border-l-[3px] px-4 py-3 transition-colors " +
                  (active
                    ? "border-l-primary bg-primary/5"
                    : "border-l-transparent hover:bg-secondary/40")
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-[13.5px] font-semibold">{item.name}</p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {item.timeLabel}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.preview}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {item.unread > 0 && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                      {item.unread > 99 ? "99+" : item.unread}
                    </span>
                  )}
                  {item.kind === "dm" ? (
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
                      Direct
                    </span>
                  ) : (
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
                      {item.members} {item.members === 1 ? "member" : "members"}
                    </span>
                  )}
                  {item.kind === "announcement" && (
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
                      Announcements
                    </span>
                  )}
                  {item.supervised && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-800">
                      <Eye className="h-2.5 w-2.5" /> Lead can read
                    </span>
                  )}
                  {item.closed && (
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
                      Closed
                    </span>
                  )}
                  {item.left && (
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
                      You left
                    </span>
                  )}
                </p>
              </Link>
            );
          })
        )}
      </div>
    </aside>
  );
}
