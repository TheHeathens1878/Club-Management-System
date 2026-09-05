/**
 * How a typed phrase finds a page (P7.2). Pure, so the ranking is testable.
 *
 * Every page carries its label, its section and a handful of everyday words.
 * A query matches when every word of it is found somewhere in those — so
 * "pay subs" finds My payments through its keywords, "next match" finds the
 * calendar, "message coach" finds New message. Whole-label matches come
 * first, then keyword matches, then section matches, each stable in menu
 * order so the same query always lists the same way.
 */

export type SearchablePage = { label: string; href: string; group: string; keywords: string[] };

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9£]+/)
    .filter((w) => w.length > 0);
}

/** The five destinations' own entries — broad words, so they yield to a specific page on a keyword tie. */
export const DESTINATION_GROUP = "Go to";

/** 0 = no match; higher is better. */
export function pageScore(page: SearchablePage, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const label = page.label.toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 90;
  if (label.includes(q)) return 80;
  // A destination's keywords are deliberately broad ("subs" reaches Me, but
  // "subs" MEANS My payments): a page that names the word itself wins.
  const broad = page.group === DESTINATION_GROUP ? 5 : 0;
  const keywords = page.keywords.map((k) => k.toLowerCase());
  if (keywords.some((k) => k === q)) return 75 - broad;
  if (keywords.some((k) => k.includes(q))) return 60 - broad;
  // Every word of the query somewhere in the label, keywords or section.
  const haystack = [label, ...keywords, page.group.toLowerCase()].join(" ");
  const parts = words(q);
  if (parts.length > 0 && parts.every((part) => haystack.includes(part))) return 40 - broad;
  if (page.group.toLowerCase().includes(q)) return 20;
  return 0;
}

/** Pages that match, best first; the first few pages when nothing is typed. */
export function rankPages<T extends SearchablePage>(pages: readonly T[], query: string): T[] {
  if (!query.trim()) return pages.slice(0, 7);
  return pages
    .map((page, index) => ({ page, index, score: pageScore(page, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.page);
}
