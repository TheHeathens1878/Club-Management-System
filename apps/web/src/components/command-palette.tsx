"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Contact, DoorOpen, FileText, Loader2, Search, Shirt } from "lucide-react";

import type { PaletteEntry } from "@/lib/destinations";
import { rankPages } from "@/lib/search-terms";

/**
 * Global search (⌘K / Ctrl-K). One field finds a page from the caller's OWN
 * menu — by its name, its section, or the everyday words it carries ("pay
 * subs") — and people, teams, events and bookings through /api/search, which
 * reads under the caller's RLS and only links where their guards will let
 * them land.
 *
 * Any element can open it by dispatching `club:search-open` — the sidebar
 * button below and the phone header's magnifier both do.
 *
 * Three remote states are drawn, not swallowed (P7.2): searching, failed
 * (with a retry), and nothing found — a search that sits blank while the
 * network thinks looks broken, and one that fails silently IS broken.
 */

type RemoteHit = {
  type: "person" | "team" | "event" | "booking";
  label: string;
  detail: string | null;
  href: string;
};

export const OPEN_SEARCH_EVENT = "club:search-open";

export function SearchTrigger({ variant }: { variant: "sidebar" | "icon" }) {
  const open = () => window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={open}
        aria-label="Search"
        className="inline-flex h-11 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Search className="h-5 w-5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      className="mb-1 hidden h-9 items-center gap-2 rounded-md border border-border/60 px-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground lg:flex"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border border-border/60 px-1 font-mono text-[10px]">⌘K</kbd>
    </button>
  );
}

const ICONS: Record<RemoteHit["type"] | "page", typeof Contact> = {
  page: FileText,
  person: Contact,
  team: Shirt,
  event: CalendarDays,
  booking: DoorOpen,
};

export function CommandPalette({ pages }: { pages: PaletteEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<RemoteHit[]>([]);
  const [remoteState, setRemoteState] = useState<"idle" | "loading" | "failed">("idle");
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((was) => !was);
      }
      if (event.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setRemote([]);
      setRemoteState("idle");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Remote half, debounced; RLS decides what comes back.
  useEffect(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    if (query.trim().length < 2) {
      setRemote([]);
      setRemoteState("idle");
      return;
    }
    setRemoteState("loading");
    const controller = new AbortController();
    fetchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { hits?: RemoteHit[] };
        setRemote(data.hits ?? []);
        setRemoteState("idle");
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        setRemote([]);
        setRemoteState("failed");
      }
    }, 250);
    return () => {
      controller.abort();
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
    };
  }, [query, attempt]);

  const pageHits = useMemo(() => rankPages(pages, query).slice(0, 7), [pages, query]);

  const rows = useMemo(
    () => [
      ...pageHits.map((page) => ({ kind: "page" as const, label: page.label, detail: page.group, href: page.href })),
      ...remote.map((hit) => ({ kind: hit.type, label: hit.label, detail: hit.detail ?? "", href: hit.href })),
    ],
    [pageHits, remote],
  );

  useEffect(() => {
    if (selected >= rows.length) setSelected(0);
  }, [rows, selected]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  if (!open) return null;

  const searching = remoteState === "loading";
  const nothing = rows.length === 0 && !searching && remoteState !== "failed";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          {searching ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((index) => Math.min(index + 1, rows.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                const row = rows[selected];
                if (row) go(row.href);
              }
            }}
            placeholder="Search — pay subs, next match, a name, a team…"
            aria-label="Search"
            aria-activedescendant={rows[selected] ? `search-row-${selected}` : undefined}
            aria-controls="search-results"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul id="search-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {nothing && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {query.trim().length < 2
                ? "Type a page, a task, a name or a team."
                : "Nothing matches. Try another word — “subs”, “fixtures”, a surname."}
            </li>
          )}
          {remoteState === "failed" && (
            <li className="flex items-center justify-between gap-3 px-3 py-3 text-sm text-destructive">
              <span>Search could not reach the club. Pages still work.</span>
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="rounded-md border px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary"
              >
                Try again
              </button>
            </li>
          )}
          {rows.map((row, index) => {
            const Icon = ICONS[row.kind];
            return (
              <li key={`${row.kind}:${row.href}`} id={`search-row-${index}`} role="option" aria-selected={index === selected}>
                <button
                  type="button"
                  onClick={() => go(row.href)}
                  onMouseEnter={() => setSelected(index)}
                  className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
                    index === selected ? "bg-primary text-primary-foreground" : ""
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                  {row.detail && (
                    <span className={`truncate text-xs ${index === selected ? "opacity-80" : "text-muted-foreground"}`}>
                      {row.detail}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {searching && rows.length > 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
              Searching people, teams, events and bookings…
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
