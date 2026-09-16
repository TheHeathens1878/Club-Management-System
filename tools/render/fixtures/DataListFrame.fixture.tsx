/**
 * One list, two shapes.
 *
 * The four states worth photographing are the four the frame decides between:
 * a full list with its column filters, a list with nothing in it at all, a
 * list whose filters hide every row, and a list in tick mode with its bulk bar
 * showing. The `filtered` case is the interesting one at 390: the table is
 * replaced by cards, the column filters fold into one sheet, and the tick is a
 * 44px target without being a 44px checkbox.
 *
 * `window.__dsSearch` is set inside each case rather than at module scope,
 * because every case is mounted into the same page and the frame reads the
 * search parameters once, when it mounts.
 */

import { useEffect } from "react";
import { Plus, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ChipStrip } from "@/components/ui/chip-strip";
import { DataListFrame, type DataColumn, type DataItem } from "@/components/ui/data-list";
import { TD } from "@/components/ui/table";
import { ToggleChip } from "@/components/ui/toggle-chip";

import type { Fixture } from "./contract";

const COLUMNS: DataColumn[] = [
  { key: "team", label: "Team", weight: 3, filterKey: "age", allLabel: "All ages" },
  { key: "venue", label: "Venue", sub: "home ground", weight: 2, filterKey: "venue", allLabel: "All venues" },
  { key: "trains", label: "Trains", sub: "default day", weight: 2, filterKey: "trains", allLabel: "Any day" },
  { key: "squad", label: "Squad", weight: 1 },
];

const TEAMS = [
  { name: "AoM FC First Team", age: "Open age", venue: "Willow Park", day: "Tuesday", players: 22, ok: true },
  { name: "AoM FC Reserves", age: "Open age", venue: "Willow Park", day: "Thursday", players: 19, ok: true },
  { name: "AoM FC Under 18s", age: "Under 18s", venue: "Ash Lane", day: "Monday", players: 17, ok: true },
  { name: "AoM FC Under 16s", age: "Under 16s", venue: "Ash Lane", day: "Wednesday", players: 15, ok: false },
  { name: "AoM FC Under 15s", age: "Under 15s", venue: "Willow Park", day: "Monday", players: 16, ok: true },
  { name: "AoM FC Under 14s", age: "Under 14s", venue: "Church Fields", day: "Tuesday", players: 14, ok: true },
  { name: "AoM FC Under 13s", age: "Under 13s", venue: "Church Fields", day: "Thursday", players: 13, ok: false },
  { name: "AoM FC Under 12s Lions", age: "Under 12s", venue: "Willow Park", day: "Wednesday", players: 12, ok: true },
  { name: "AoM FC Under 12s Tigers", age: "Under 12s", venue: "Ash Lane", day: "Wednesday", players: 11, ok: true },
  { name: "AoM FC Under 11s Venus", age: "Under 11s", venue: "Church Fields", day: "Friday", players: 10, ok: true },
  { name: "AoM FC Under 10s", age: "Under 10s", venue: "Willow Park", day: "Saturday", players: 12, ok: true },
  { name: "AoM FC Under 9s", age: "Under 9s", venue: "Ash Lane", day: "Saturday", players: 9, ok: false },
];

const ITEMS: DataItem[] = TEAMS.map((team, index) => ({
  key: team.name,
  haystack: `${team.name} ${team.age} ${team.venue}`.toLocaleLowerCase("en-GB"),
  facets: { age: team.age, venue: team.venue, trains: team.day },
  dim: index === TEAMS.length - 1,
  cells: (
    <>
      <TD>
        <span className="font-semibold">{team.name}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{team.age}</span>
      </TD>
      <TD>{team.venue}</TD>
      <TD>{team.day}</TD>
      <TD>
        {team.ok ? (
          <Badge variant="success">{team.players}</Badge>
        ) : (
          <Badge variant="warning">{team.players}</Badge>
        )}
      </TD>
    </>
  ),
  card: (
    <span className="touch flex flex-col justify-center px-4 py-3">
      <span className="font-semibold leading-tight">{team.name}</span>
      <span className="mt-0.5 text-xs text-muted-foreground">
        {team.age} · {team.venue} · trains {team.day} · {team.players} players
      </span>
    </span>
  ),
}));

function search(value: string) {
  if (typeof window !== "undefined") {
    (window as unknown as { __dsSearch?: string }).__dsSearch = value;
  }
}

/**
 * Tick mode only shows its bar once something is ticked, and the frame owns
 * that state — so the case ticks two rows for itself on mount, the same way
 * the Sheet fixture opens its own sheet.
 */
function TickTwo() {
  useEffect(() => {
    const boxes = document.querySelectorAll<HTMLInputElement>('#root input[type="checkbox"]');
    for (const box of Array.from(boxes).slice(1, 3)) box.click();
  }, []);
  return null;
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl space-y-4 p-4">{children}</div>;
}

const NewTeam = (
  <button type="button" className="touch inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm">
    <Plus className="h-4 w-4" /> New team
  </button>
);

const fixture: Fixture = {
  cases: {
    // Twelve rows, three column filters, a search box and a footer: the whole
    // frame, in the state a desk actually sees it.
    filtered: () => {
      search("");
      return (
        <Frame>
          <DataListFrame
            items={ITEMS}
            columns={COLUMNS}
            search={{ param: "q", placeholder: "Search teams", initial: "" }}
            actions={NewTeam}
            chips={
              <ChipStrip>
                <ToggleChip on>All teams</ToggleChip>
                <ToggleChip on={false} count={3}>
                  Needs staff
                </ToggleChip>
              </ChipStrip>
            }
            empty={{ icon: <Users className="h-5 w-5" aria-hidden />, title: "No teams yet." }}
            noMatch="No team matches that search or those filters."
            footerNote="Format follows the age group unless the club has set one on the team"
            showMore={{ label: "Show the other 6 teams", href: "?status=all" }}
          />
        </Frame>
      );
    },

    // Nothing on the books: the built-in EmptyState, with its one door out.
    empty: () => {
      search("");
      return (
        <Frame>
          <DataListFrame
            items={[]}
            columns={COLUMNS}
            search={{ param: "q", placeholder: "Search teams", initial: "" }}
            empty={{
              icon: <Users className="h-5 w-5" aria-hidden />,
              title: "No teams yet.",
              body: "A team is what fixtures, training and squads all hang off — add the first one.",
              action: { href: "/teams", label: "New team" },
            }}
          />
        </Frame>
      );
    },

    // Rows exist; the filter in the URL hides every one of them. A different
    // sentence from "no teams yet", because it is a different problem.
    nomatch: () => {
      search("f.venue=Oak+Meadow");
      return (
        <Frame>
          <DataListFrame
            items={ITEMS}
            columns={COLUMNS}
            search={{ param: "q", placeholder: "Search teams", initial: "" }}
            empty={{ icon: <Users className="h-5 w-5" aria-hidden />, title: "No teams yet." }}
            noMatch="No team matches that search or those filters."
          />
        </Frame>
      );
    },

    // Tick mode. The bar is the caller's; the frame only decides when it shows.
    select: () => {
      search("f.age=Under+12s");
      return (
        <Frame>
          <DataListFrame
            items={ITEMS}
            columns={COLUMNS}
            select={{
              label: "Tick this team",
              bar: (keys, clear) => (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-sm">
                  <span className="font-medium">{keys.length} ticked</span>
                  <span className="text-muted-foreground">Give them all a home venue</span>
                  <button type="button" onClick={clear} className="touch ml-auto text-primary">
                    Clear
                  </button>
                </div>
              ),
            }}
            empty={{ icon: <Users className="h-5 w-5" aria-hidden />, title: "No teams yet." }}
            noMatch="No team matches those filters."
          />
          <TickTwo />
        </Frame>
      );
    },
  },
};

export default fixture;
