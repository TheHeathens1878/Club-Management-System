/**
 * How a referee's age group reads in a list.
 *
 * The rule is the FA's and the club follows it (Adam, 2026-09-01: referees
 * show their age group in the group list, "one band below until 16"). It is
 * computed and enforced in the database — `referee_bands()`,
 * `referee_may_take_band()` and the claim guard, all 20260901210000 — and this
 * file only puts the four numbers into a sentence.
 *
 * The three states are deliberately distinct, because two of them look alike
 * and mean opposite things: a referee with NO ceiling takes everything, and a
 * referee whose date of birth the club has not got takes nothing.
 */

export type RefereeBand = {
  personId: string;
  dobKnown: boolean;
  ownBand: number | null;
  unlimited: boolean;
  maxBand: number | null;
};

export type RefereeBandLabel = {
  /** "U15", or null when the club has no date of birth. */
  own: string | null;
  /** What they may take, in words. */
  takes: string;
  /** True when this is a "the club needs something" state, not a rule. */
  needsDob: boolean;
};

export function refereeBandLabel(band: RefereeBand): RefereeBandLabel {
  if (!band.dobKnown) {
    return {
      own: null,
      takes: "No games yet — the club needs their date of birth",
      needsDob: true,
    };
  }
  const own = band.ownBand === null ? null : `U${band.ownBand}`;
  if (band.unlimited) {
    return { own, takes: "Any age group", needsDob: false };
  }
  if (band.maxBand === null) {
    // Not reachable while the database keeps its own rule: a known date of
    // birth under the open age always yields a ceiling. Said plainly rather
    // than rendered as an empty space if it ever is.
    return { own, takes: "No games — ask a club administrator", needsDob: false };
  }
  return { own, takes: `U${band.maxBand} and below`, needsDob: false };
}

/** The whole thing on one line, for a badge. */
export function refereeBandSummary(band: RefereeBand): string {
  const label = refereeBandLabel(band);
  return label.own ? `${label.own} · ${label.takes}` : label.takes;
}
