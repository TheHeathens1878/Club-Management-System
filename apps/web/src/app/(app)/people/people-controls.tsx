"use client";

/**
 * The two controls that change the list without a Search button.
 *
 * Adam, 2026-08-26: "typing a name should auto filter the results" and "we
 * should be able to choose what columns we want to see".
 *
 * Both write to the URL rather than to component state, because this page's
 * design is that every list is a URL somebody can bookmark or send. Typing
 * replaces history rather than pushing it, so Back leaves the page instead of
 * walking the reader letter by letter through what they just typed.
 *
 * The filtering is done by the SERVER on every keystroke-pause, not by
 * hiding rows on the client. The list is paginated and RLS-scoped, so a
 * client-side filter would only ever search the 25 rows already on screen and
 * would quietly tell somebody a member does not exist.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Columns3, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  PEOPLE_COLUMNS,
  parsePeopleColumns,
  serialisePeopleColumns,
  type PeopleColumnKey,
} from "@/lib/people-columns";

/** Long enough not to fire on every letter, short enough not to feel laggy. */
const DEBOUNCE_MS = 300;

export function PeopleControls({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [text, setText] = useState(initialQuery);
  const [picking, setPicking] = useState(false);
  const chosen = parsePeopleColumns(params.get("cols"));

  // The URL is the source of truth. If it changes underneath us — Clear
  // filters, the Back button, a link somebody sent — the box follows it.
  const lastPushed = useRef(initialQuery);
  useEffect(() => {
    const fromUrl = params.get("q") ?? "";
    if (fromUrl !== lastPushed.current) {
      lastPushed.current = fromUrl;
      setText(fromUrl);
    }
  }, [params]);

  function write(next: URLSearchParams) {
    // Any change to the filters puts the reader back on page 1: staying on
    // page 3 of a list that now has one page shows an empty screen and looks
    // like "nobody matches".
    next.delete("page");
    const query = next.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  // --- typing ---------------------------------------------------------------
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (text === current) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      lastPushed.current = text;
      if (text.trim()) next.set("q", text.trim());
      else next.delete("q");
      write(next);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, params]);

  // --- columns --------------------------------------------------------------
  function toggle(key: PeopleColumnKey) {
    const next = new URLSearchParams(params.toString());
    const wanted = chosen.includes(key)
      ? chosen.filter((k) => k !== key)
      : [...chosen, key];
    const value = serialisePeopleColumns(wanted);
    if (value) next.set("cols", value);
    else next.delete("cols");
    write(next);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="w-full space-y-1.5 sm:max-w-sm">
        <Label htmlFor="people-q">Name or email</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="people-q"
            name="q"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Start typing…"
            autoComplete="off"
            className="min-h-[44px] pl-8 pr-9 lg:min-h-0"
          />
          {pending && (
            <Loader2
              aria-hidden="true"
              className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {pending ? "Searching…" : "The list filters as you type."}
        </p>
      </div>

      <div className="relative">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] lg:min-h-0"
          onClick={() => setPicking((open) => !open)}
          aria-expanded={picking}
        >
          <Columns3 className="h-3.5 w-3.5" /> Columns
        </Button>

        {picking && (
          <>
            {/* Clicking anywhere else closes it, including on a phone. */}
            <button
              type="button"
              aria-label="Close the column list"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setPicking(false)}
            />
            <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border bg-card p-1 shadow-lg">
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Shown on the desk view. The phone card always shows the same summary.
              </p>
              {PEOPLE_COLUMNS.map((column) => {
                const on = chosen.includes(column.key);
                return (
                  <button
                    key={column.key}
                    type="button"
                    disabled={column.fixed}
                    onClick={() => toggle(column.key)}
                    className={
                      "flex min-h-[44px] w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm lg:min-h-0 " +
                      (column.fixed
                        ? "cursor-default text-muted-foreground"
                        : "hover:bg-muted/60")
                    }
                  >
                    <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border">
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span>
                      {column.label}
                      {column.fixed && " (always shown)"}
                      {column.hint && (
                        <span className="block text-xs text-muted-foreground">{column.hint}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
