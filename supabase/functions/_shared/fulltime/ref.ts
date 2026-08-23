/**
 * `external_ref` — the key P2.4 upserts fixtures on.
 *
 * "Handles reschedules/postponements as updates, never duplicates" only works
 * if the same match keeps the same reference when its kick-off moves. So the
 * FA's own `displayFixture.html?id=` is always preferred: it survives a
 * reschedule, a postponement and a result being added.
 *
 * When a row has no link (a manual CSV paste, or a page that stopped linking),
 * we fall back to a hash of the things that identify the match *and do not
 * change when it is rescheduled*… except the date, which does. That is a real
 * limitation and not one a hash can fix: a rescheduled CSV row is a new row.
 * The importer should treat hashed references as weaker than FA ids, and
 * P2.3's preview screen is where a human gets to notice.
 */

/** 32-bit FNV-1a over the UTF-8 bytes of a string. */
function fnv1a32(input: string, offsetBasis: number): number {
  let hash = offsetBasis >>> 0;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A 16-hex-character digest. Two independent FNV-1a passes (different offset
 * bases, one over the reversed string) rather than one, because 32 bits is
 * enough collisions to matter across a whole league's history.
 */
export function fnv1a64Hex(input: string): string {
  const a = fnv1a32(input, 0x811c9dc5);
  const b = fnv1a32([...input].reverse().join(""), 0x01000193);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The `id` from a `displayFixture.html?id=…` href, if that is what it is. */
export function fixtureIdFromHref(href: string): string | undefined {
  const m = /displayFixture\.html\?(?:[^#]*&)?id=(\d+)/i.exec(href);
  return m?.[1];
}

/** The minimum a fixture needs before it can be given a reference. */
export type ExternalRefInput = {
  externalRef?: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  competition?: string;
};

function normaliseForHash(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The FA's fixture id when the row had one, otherwise a deterministic
 * `ft-hash-…` derived from date, teams and competition.
 */
export function stableExternalRef(fixture: ExternalRefInput): string {
  const existing = fixture.externalRef?.trim();
  if (existing) return existing;

  const key = [
    normaliseForHash(fixture.date),
    normaliseForHash(fixture.homeTeam),
    normaliseForHash(fixture.awayTeam),
    normaliseForHash(fixture.competition),
  ].join("|");
  return `ft-hash-${fnv1a64Hex(key)}`;
}
