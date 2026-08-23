/**
 * The shapes every entry point in this package speaks in.
 *
 * `ParsedFixture` is deliberately close to the P2.3 `fixtures` table without
 * being the table: parsing must never depend on the database, and the
 * importer, not the parser, decides how a row maps onto a club's own teams.
 */

/** Where a fixture is in its life cycle, as far as Full-Time will tell us. */
export type FixtureStatus = "scheduled" | "played" | "postponed" | "cancelled" | "abandoned";

/** One fixture or result row. */
export type ParsedFixture = {
  /**
   * The `displayFixture.html?id=` identifier when the row links to one — the
   * FA's own stable id, and therefore the upsert key P2.4 wants. Rows without
   * a link get a deterministic hash instead; see {@link stableExternalRef}.
   */
  externalRef: string;
  /**
   * The single-letter type Full-Time prints in the first column: `L` league,
   * `C` cup, `F` friendly, `O` other. Kept verbatim — the FA adds letters, and
   * an unknown one should survive the round trip rather than be dropped.
   */
  type: string;
  /** Kick-off as an ISO UTC instant, from the Europe/London wall clock shown. */
  kickoffAt: string;
  /** Kick-off date in Europe/London, `YYYY-MM-DD`. */
  date: string;
  /** Kick-off time in Europe/London, `HH:MM`, when the page gives one. */
  time?: string;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  status: FixtureStatus;
  /** Competition name, when the table has a column for it. */
  competition?: string;
  /** Venue/ground, when the table has a column for it. */
  venue?: string;
  /** The row's visible text, kept so an admin can see what we read. */
  raw: string;
};

/** A `<select name="selectedSeason">` option. */
export type ParsedSeason = {
  id: string;
  name: string;
  selected: boolean;
};

/** A `<select name="selectedTeam">` option. */
export type ParsedTeam = {
  id: string;
  name: string;
};

/** Everything one Full-Time page yields. */
export type ParsedPage = {
  seasons: ParsedSeason[];
  teams: ParsedTeam[];
  fixtures: ParsedFixture[];
  /**
   * Rows we recognised as fixture rows but could not read. Never empty for a
   * page whose markup has moved on, which is exactly the breakage signal P2.4
   * wants to alert on — and never thrown, because one bad row must not lose
   * the other twenty.
   */
  warnings: string[];
};

/** A fixture seen from one team's point of view. */
export type TeamFixture = ParsedFixture & {
  isHome: boolean;
  opponent: string;
};

/** Options accepted by the page parser. */
export type ParseOptions = {
  /**
   * The wall-clock zone the page's times are in. Full-Time is an FA product
   * and always prints Europe/London; the option exists so the assumption is
   * visible at the call site rather than buried.
   */
  timeZone?: "Europe/London";
};
