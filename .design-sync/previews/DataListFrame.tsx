import { Badge, Button, ChipStrip, DataListFrame, TD, ToggleChipLink } from "@club/web";
import { Plus, Users } from "lucide-react";

window.__dsPathname = "/my-teams";

const COLUMNS = [
  { key: "team", label: "Team", weight: 3 },
  { key: "age", label: "Age group", weight: 2, filterKey: "age", allLabel: "All ages" },
  { key: "day", label: "Match day", sub: "from the league", weight: 2, filterKey: "day", allLabel: "Any day" },
  { key: "coach", label: "Coach", weight: 3 },
  { key: "players", label: "Players", weight: 1, align: "right" as const },
];

const TEAMS = [
  { name: "U9 Mercury", age: "U9", day: "Saturday", coach: "Priya Nair", players: 12, active: true },
  { name: "U10 Mars", age: "U10", day: "Saturday", coach: "Tom Wickes", players: 13, active: true },
  { name: "U11 Venus", age: "U11", day: "Sunday", coach: "Dave Ellery", players: 14, active: true },
  { name: "U12 Jupiter", age: "U12", day: "Sunday", coach: "Dave Ellery", players: 16, active: true },
  { name: "U14 Saturn", age: "U14", day: "Saturday", coach: "Lena Okoro", players: 18, active: true },
  { name: "U16 Neptune", age: "U16", day: "Sunday", coach: "Unassigned", players: 9, active: false },
];

// The cells are `<td>`s the page already knows how to render, and the phone
// card is the same row said differently. The frame never looks inside either.
const ITEMS = TEAMS.map((team) => ({
  key: team.name,
  haystack: `${team.name} ${team.age} ${team.day} ${team.coach}`.toLowerCase(),
  facets: { age: team.age, day: team.day },
  dim: !team.active,
  cells: (
    <>
      <TD className="font-medium">{team.name}</TD>
      <TD>{team.age}</TD>
      <TD className="whitespace-nowrap">{team.day}</TD>
      <TD className={team.coach === "Unassigned" ? "text-muted-foreground" : undefined}>{team.coach}</TD>
      <TD className="text-right tabular-nums">{team.players}</TD>
    </>
  ),
  card: (
    <div className="space-y-1 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-row font-medium">{team.name}</span>
        {team.active ? <Badge variant="success">{team.players}</Badge> : <Badge variant="muted">Archived</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        {team.age} · {team.day} · {team.coach}
      </p>
    </div>
  ),
}));

const List = () => (
  <DataListFrame
    items={ITEMS}
    columns={COLUMNS}
    search={{ param: "q", placeholder: "Search teams and coaches", initial: "" }}
    chips={
      <ChipStrip>
        <ToggleChipLink href="/my-teams" active>
          Everything
        </ToggleChipLink>
        <ToggleChipLink href="/my-teams?mine=1" active={false} count={2}>
          Yours
        </ToggleChipLink>
        <ToggleChipLink href="/my-teams?needs=coach" active={false} count={1}>
          Needs a coach
        </ToggleChipLink>
      </ChipStrip>
    }
    actions={
      <Button size="touch">
        <Plus className="h-4 w-4" aria-hidden />
        New team
      </Button>
    }
    select={{
      label: "Select this team",
      bar: (keys, clear) => (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-secondary px-4 py-2.5 text-sm">
          <span className="min-w-0 flex-1">{keys.length} selected</span>
          <Button size="sm" variant="outline">
            Message them
          </Button>
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        </div>
      ),
    }}
    empty={{
      title: "No teams yet",
      body: "Teams appear here once the club adds one, or the league import brings them in.",
      icon: <Users className="h-5 w-5" aria-hidden />,
      action: { href: "/my-teams/new", label: "Add a team" },
    }}
    noMatch="No team matches those filters."
    footerNote="13 teams · 7 shown"
    showMore={{ label: "Show the other 6 teams", href: "/my-teams?all=1" }}
  />
);

// At a desk: one dense table, with a filter under every column that carries one.
export const DeskTable = () => (
  <div className="space-y-3 bg-background p-4" style={{ minWidth: 960 }}>
    <List />
  </div>
);

// The same rows on a phone, as cards, filtered by the same state — the whole
// point of the frame is that the two shapes cannot drift apart.
export const PhoneCards = () => (
  <div
    className="ds-phonelist"
    style={{ width: 390, border: "1px solid hsl(30 12% 85%)", borderRadius: 12, overflow: "hidden" }}
  >
    {/* The capture viewport is 1200 wide, so `lg:` is live; the frame is the
        phone, so the phone twin is forced back on and the desk table off. */}
    <style>
      {".ds-phonelist .lg\\:hidden { display: block !important; }" +
        ".ds-phonelist .hidden.lg\\:block { display: none !important; }" +
        ".ds-phonelist .lg\\:flex-row { flex-direction: column !important; }" +
        ".ds-phonelist .lg\\:items-end { align-items: stretch !important; }"}
    </style>
    <div className="space-y-3 bg-background px-4 py-4">
      <List />
    </div>
  </div>
);
