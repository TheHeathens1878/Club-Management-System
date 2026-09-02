"use client";

/**
 * Type-to-search team picker.
 *
 * Adam, 2026-09-02: "the coach should also select the team on sign up — a
 * search box for team name." The club has eighty-odd teams and a coach knows
 * exactly which one is theirs, so a dropdown of eighty is a scroll and a
 * search box is one word.
 *
 * Unlike `PersonPicker`, the list is shipped to the browser up front and
 * filtered there. Two reasons: the first place this is used is the joining
 * form's first step, where the reader is NOT signed in and a server action
 * reading `teams` would be refused (`teams_read` is `to authenticated`, which
 * is why `team_options()` exists); and a team's name and age group are on the
 * club's public pages already, so there is nothing here to keep back. A person
 * search could never be shipped that way, which is the difference.
 *
 * The chosen id travels in a hidden input, so the surrounding form stays a
 * plain server-action form.
 */

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { Input, Label } from "@/components/ui/input";

export type TeamOption = { id: string; name: string; ageGroup: string | null };

/** Enough to choose from, few enough to read without scrolling on a phone. */
const MAX_SHOWN = 8;

function label(team: TeamOption): string {
  return team.ageGroup ? `${team.name} (${team.ageGroup})` : team.name;
}

export function TeamPicker({
  id,
  name,
  teams,
  label: fieldLabel = "Which team?",
  placeholder = "Start typing a team name…",
  help,
  required = false,
}: {
  id: string;
  name: string;
  teams: TeamOption[];
  label?: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<TeamOption | null>(null);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term === "") return teams.slice(0, MAX_SHOWN);
    return teams.filter((team) => label(team).toLowerCase().includes(term)).slice(0, MAX_SHOWN);
  }, [query, teams]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{fieldLabel}</Label>
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm">
          <span className="min-w-0 truncate font-medium">{label(selected)}</span>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQuery("");
            }}
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-secondary lg:min-h-0 lg:min-w-0"
            aria-label="Choose a different team"
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              className="pl-8"
              aria-required={required}
            />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-md border">
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No team of that name. Leave it blank and the club will place you.
              </p>
            ) : (
              matches.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => setSelected(team)}
                  className="block w-full px-3 py-3 text-left text-sm hover:bg-secondary lg:py-2"
                >
                  {label(team)}
                </button>
              ))
            )}
          </div>
        </>
      )}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
