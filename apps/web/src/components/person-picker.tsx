"use client";

/**
 * Type-to-search person picker.
 *
 * The list comes from `searchPeople`, a server action that reads `people`
 * through the signed-in user's own client — so what the picker can offer is
 * exactly what RLS lets the caller read, and no member list is shipped to the
 * browser up front. The chosen id travels in a hidden input so the surrounding
 * form stays a plain server-action form.
 */

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";

import { Input, Label } from "@/components/ui/input";
import { searchPeople, type PersonOption } from "@/app/(app)/people/search-actions";

/** Long enough that a keystroke does not become a query. */
const DEBOUNCE_MS = 250;

export function PersonPicker({
  id,
  name,
  label,
  placeholder = "Search by name or email…",
  excludeIds = [],
  required = false,
  onPick,
}: {
  id: string;
  name: string;
  label: string;
  placeholder?: string;
  excludeIds?: string[];
  required?: boolean;
  /** Fired with the chosen person, and with null when the choice is cleared. */
  onPick?: (person: PersonOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonOption[]>([]);
  const [selected, setSelected] = useState<PersonOption | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (selected) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchPeople(term).then((rows) => {
        if (cancelled) return;
        setResults(rows);
        setSearching(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected]);

  const offered = results.filter((r) => !excludeIds.includes(r.id));

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{selected.name}</span>
            {selected.email ? (
              <span className="text-muted-foreground"> · {selected.email}</span>
            ) : null}
            {!selected.dobKnown ? (
              <span className="text-amber-700"> · no date of birth on file</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQuery("");
              setResults([]);
              onPick?.(null);
            }}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary"
            aria-label="Clear the chosen person"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={id}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              className="pl-8"
              aria-required={required}
            />
          </div>
          {query.trim().length >= 2 && (
            <div className="max-h-56 overflow-y-auto rounded-md border">
              {searching && offered.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
              )}
              {!searching && offered.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Nobody found. Add them on the People screen first.
                </p>
              )}
              {offered.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => {
                    setSelected(person);
                    onPick?.(person);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                >
                  <span className="font-medium">{person.name}</span>
                  {person.email ? (
                    <span className="text-muted-foreground"> · {person.email}</span>
                  ) : null}
                  {!person.dobKnown ? (
                    <span className="text-amber-700"> · no DOB</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
