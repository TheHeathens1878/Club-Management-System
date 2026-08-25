/**
 * Where the club's members live, and the county that follows from it.
 *
 * Adam, 2026-08-25: "Whenever someone types Sale in town or city, I want you
 * auto-complete the County to Greater Manchester and not let them change it."
 *
 * The club is in Sale and nearly every family it deals with is in Trafford or
 * next door to it. Those towns have exactly one county, so asking a parent to
 * type it is asking them to make a mistake — "Cheshire" for Sale is the
 * commonest, because it was Cheshire until 1974 and the postal address said so
 * for years afterwards. A town in this table fills the county in and holds it
 * there; a town that is not in it leaves the field free, because the club has
 * no business telling somebody in Leeds where they live.
 *
 * Matching ignores case, punctuation and surrounding space, so "SALE",
 * " sale " and "Sale " all land on the same row. It does NOT match a town
 * inside a longer string: "Sale Moor" is its own place and is listed on its
 * own terms.
 *
 * Pure data and pure functions: imported by client components.
 */

/** The one county each of these towns is in. Add a town, not a rule. */
export const TOWN_COUNTIES: Readonly<Record<string, string>> = {
  // Trafford — the club's own borough.
  sale: "Greater Manchester",
  "sale moor": "Greater Manchester",
  brooklands: "Greater Manchester",
  "ashton on mersey": "Greater Manchester",
  altrincham: "Greater Manchester",
  bowdon: "Greater Manchester",
  hale: "Greater Manchester",
  "hale barns": "Greater Manchester",
  timperley: "Greater Manchester",
  urmston: "Greater Manchester",
  flixton: "Greater Manchester",
  davyhulme: "Greater Manchester",
  stretford: "Greater Manchester",
  "old trafford": "Greater Manchester",
  partington: "Greater Manchester",
  carrington: "Greater Manchester",
  "broadheath": "Greater Manchester",
  // The neighbours the club's fixtures and families reach into.
  manchester: "Greater Manchester",
  chorlton: "Greater Manchester",
  "chorlton cum hardy": "Greater Manchester",
  didsbury: "Greater Manchester",
  withington: "Greater Manchester",
  wythenshawe: "Greater Manchester",
  northenden: "Greater Manchester",
  salford: "Greater Manchester",
  eccles: "Greater Manchester",
  swinton: "Greater Manchester",
  worsley: "Greater Manchester",
  stockport: "Greater Manchester",
  cheadle: "Greater Manchester",
  "cheadle hulme": "Greater Manchester",
  gatley: "Greater Manchester",
  "heald green": "Greater Manchester",
  bramhall: "Greater Manchester",
  marple: "Greater Manchester",
  denton: "Greater Manchester",
  droylsden: "Greater Manchester",
  "ashton under lyne": "Greater Manchester",
  oldham: "Greater Manchester",
  rochdale: "Greater Manchester",
  bury: "Greater Manchester",
  bolton: "Greater Manchester",
  wigan: "Greater Manchester",
  leigh: "Greater Manchester",
  "sale west": "Greater Manchester",
};

/**
 * The lookup key for a typed town: lower case, no punctuation, single spaces.
 * "Ashton-on-Mersey" and "ashton on mersey" are the same place; so are
 * "Chorlton-cum-Hardy" and "chorlton cum hardy".
 */
export function townKey(town: string): string {
  const trimmed = town.trim().toLowerCase();
  // A hyphen joins words, so it becomes the space it stands for: nobody types
  // "Ashton-on-Mersey" meaning "ashtononmersey".
  const spaced = trimmed.replace(/[-–—_/.,']+/g, " ");
  const withoutPunctuation = spaced.replace(/[^a-z0-9\s]/g, "");
  return withoutPunctuation.replace(/\s+/g, " ").trim();
}

/**
 * The county a town settles, or null when the club does not know. Null means
 * "let them type it" — never a guess.
 */
export function countyForTown(town: string | null | undefined): string | null {
  if (!town) return null;
  const key = townKey(town);
  if (!key) return null;
  return TOWN_COUNTIES[key] ?? TOWN_COUNTIES[key.replace(/\s/g, "")] ?? null;
}

/** True when the county field should be filled in and held there. */
export function countyIsSettled(town: string | null | undefined): boolean {
  return countyForTown(town) !== null;
}
