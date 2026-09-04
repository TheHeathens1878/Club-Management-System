"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Contact, FileText, Search, Shirt } from "lucide-react";

/**
 * Global search (⌘K / Ctrl-K) — the 2026-09-04 audit's biggest gap: nothing
 * in the app could answer "type a name, get the thing". One field finds a
 * page from the caller's OWN menu, and people/teams through /api/search,
 * which reads under the caller's RLS and only links where their guards will
 * let them land.
 *
 * Any element can open it by dispatching `club:search-open` — the sidebar
 * button below and the phone header's magnifier both do.
 */

export type PaletteEntry = { label: string; href: string; group: string };

type RemoteHit = { type: "person" | "team"; label: string; detail: string | null; href: string };

export const OPEN_SEARCH_EVENT = "club:search-open";

export function SearchTrigger({ variant }: { variant: "sidebar" | "icon" }) {
  const open = () => window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={open}
        aria-label="Search"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
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

export function CommandPalette({ pages }: { pages: PaletteEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<RemoteHit[]>([]);
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
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Remote half, debounced; RLS decides what comes back.
  useEffect(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    if (query.trim().length < 2) {
      setRemote([]);
      return;
    }
    fetchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (!res.ok) return;
        const data = (await res.json()) as { hits?: RemoteHit[] };
        setRemote(data.hits ?? []);
      } catch {
        /* a failed search types like an empty one */
      }
    }, 250);
    return () => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
    };
  }, [query]);

  const pageHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages.slice(0, 7);
    return pages
      .filter((page) => page.label.toLowerCase().includes(q) || page.group.toLowerCase().includes(q))
      .slice(0, 7);
  }, [pages, query]);

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
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
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
            placeholder="Search pages, people, teams…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {rows.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing matches. People and teams need at least two letters.
            </li>
          )}
          {rows.map((row, index) => (
            <li key={`${row.kind}:${row.href}`}>
              <button
                type="button"
                onClick={() => go(row.href)}
                onMouseEnter={() => setSelected(index)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
                  index === selected ? "bg-primary text-primary-foreground" : ""
                }`}
              >
                {row.kind === "person" ? (
                  <Contact className="h-4 w-4 shrink-0 opacity-70" />
                ) : row.kind === "team" ? (
                  <Shirt className="h-4 w-4 shrink-0 opacity-70" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 opacity-70" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                {row.detail && (
                  <span className={`truncate text-xs ${index === selected ? "opacity-80" : "text-muted-foreground"}`}>
                    {row.detail}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
