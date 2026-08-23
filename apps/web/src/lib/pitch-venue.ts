/**
 * Venues, without a venues table.
 *
 * The club has no separate venue model — a pitch resource is named
 * "Venue – Pitch N" (an EN DASH, U+2013, with a space either side) and the
 * prefix is the venue. That convention is what lets a pitch picker be grouped
 * by ground without a migration, and it is deliberately forgiving: a resource
 * named simply "Astro" is its own venue rather than an error.
 */

/** The separator in a pitch name: space, EN DASH (U+2013), space. */
export const VENUE_SEPARATOR = " – ";

export type VenueGroup<T> = { venue: string; pitches: T[] };

/**
 * "Ashton Park – Pitch 2" → venue "Ashton Park", pitch "Pitch 2".
 * Anything that does not carry the separator is its own venue, named in full.
 */
export function splitVenue(name: string): { venue: string; pitch: string } {
  const index = name.indexOf(VENUE_SEPARATOR);
  if (index === -1) return { venue: name, pitch: name };
  const venue = name.slice(0, index).trim();
  const pitch = name.slice(index + VENUE_SEPARATOR.length).trim();
  if (venue === "" || pitch === "") return { venue: name, pitch: name };
  return { venue, pitch };
}

/**
 * Group pitches by their venue prefix, keeping the order they arrived in —
 * which is `sort_order` then `name`, the club's own ordering — both for the
 * venues and for the pitches inside each one.
 */
export function groupByVenue<T extends { name: string }>(pitches: T[]): VenueGroup<T>[] {
  const groups: VenueGroup<T>[] = [];
  const byVenue = new Map<string, VenueGroup<T>>();
  for (const pitch of pitches) {
    const { venue } = splitVenue(pitch.name);
    let group = byVenue.get(venue);
    if (group === undefined) {
      group = { venue, pitches: [] };
      byVenue.set(venue, group);
      groups.push(group);
    }
    group.pitches.push(pitch);
  }
  return groups;
}
