"use client";

/**
 * Type-to-search team picker.
 *
 * Adam, 2026-09-02: "the coach should also select the team on sign up — a
 * search box for team name." The club has eighty-odd teams and a coach knows
 * exactly which one is theirs, so a dropdown of eighty is a scroll and a
 * search box is one word.
 *
 * Later the same day: "should be able to select more than 1 team in the coach
 * dropdown as some coach two." Hence `multiple`. It is a different question,
 * not a different widget — one team or several, the coach types a name and
 * picks it — so it is the same component with the chosen ones kept as a list
 * and rendered as chips. In `multiple` mode the hidden input is repeated, one
 * per team, so the surrounding server action reads `formData.getAll(name)`.
 *
 * Unlike `PersonPicker`, the list is shipped to the browser up front and
 * filtered there. Two reasons: the first place this is used is the joining
 * form, where the reader may not be signed in and a server action reading
 * `teams` would be refused (`teams_read` is `to authenticated`, which is why
 * `team_options()` exists); and a team's name and age group are on the club's
 * public pages already, so there is nothing here to keep back. A person search
 * could never be shipped that way, which is the difference.
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
  multiple = false,
}: {
  id: string;
  name: string;
  teams: TeamOption[];
  label?: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  /** More than one team may be chosen; the hidden input repeats (Adam, 2026-09-02). */
  multiple?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<TeamOption[]>([]);

  // In single mode the search box disappears once a team is chosen; in
  // multiple mode it never does, because "and also the U12s" is the whole
  // point of the mode.
  const searching = multiple || selected.length === 0;

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    const chosen = new Set(selected.map((team) => team.id));
    const pool = teams.filter((team) => !chosen.has(team.id));
    if (term === "") return pool.slice(0, MAX_SHOWN);
    return pool.filter((team) => label(team).toLowerCase().includes(term)).slice(0, MAX_SHOWN);
  }, [query, teams, selected]);

  function choose(team: TeamOption) {
    setSelected((current) => (multiple ? [...current, team] : [team]));
    setQuery("");
  }

  function drop(teamId: string) {
    setSelected((current) => current.filter((team) => team.id !== teamId));
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{fieldLabel}</Label>
      {/* One input per chosen team. Single mode still posts exactly one value,
          empty when nothing is chosen, so every existing reader is unaffected. */}
      {multiple ? (
        selected.map((team) => <input key={team.id} type="hidden" name={name} value={team.id} />)
      ) : (
        <input type="hidden" name={name} value={selected[0]?.id ?? ""} />
      )}

      {selected.length > 0 && (
        <ul className={multiple ? "flex flex-wrap gap-2" : "space-y-1"}>
          {selected.map((team) => (
            <li
              key={team.id}
              className="flex items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate font-medium">{label(team)}</span>
              <button
                type="button"
                onClick={() => drop(team.id)}
                className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-secondary lg:min-h-0 lg:min-w-0"
                aria-label={multiple ? `Remove ${label(team)}` : "Choose a different team"}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {searching && (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={id}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={selected.length > 0 ? "Add another team…" : placeholder}
              autoComplete="off"
              className="pl-8"
              aria-required={required}
            />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-md border">
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {selected.length > 0
                  ? "No other team of that name."
                  : "No team of that name. Leave it blank and the club will place you."}
              </p>
            ) : (
              matches.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => choose(team)}
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
