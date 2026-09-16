/**
 * The pure half of a data list: what the URL says its filters are, what values
 * a column can offer, and which rows survive.
 *
 * It lives here rather than inside `components/ui/data-list.tsx` so a server
 * page can read the same filters the frame writes — a client module's exports
 * are not callable from a server component, and a list whose server half and
 * client half disagree about what `?f.venue=` means is a list that lies.
 *
 * COLUMN FILTERS ARE URL PARAMS, under the `f.` prefix. The prefix is the
 * whole point: these lists already carry `?q`, `?status`, `?cols`, `?team`,
 * `?type`, `?role`, `?page` and `?filter`, and a column called "team" or
 * "type" would otherwise quietly overwrite one of them. Nothing outside this
 * file may write an `f.`-prefixed parameter.
 *
 * Filtering happens in the browser over the rows the server already sent. That
 * is only honest for a list that is sent whole (the teams list is), and it is
 * why the People list — one page of twenty-five rows out of hundreds — has no
 * column filters at all: a filter that searched a quarter of one page would
 * tell somebody a member does not exist.
 */

/** Only the part of a column this module needs: which facet it filters on. */
export type FilterableColumn = { filterKey?: string };

/** Only the part of a row this module needs: its search text and its facets. */
export type FilterableRow = {
  /** Everything the search box looks at, already lower-cased. */
  haystack: string;
  /** filterKey → this row's value for that column. */
  facets?: Record<string, string>;
};

/** The prefix that keeps a column filter out of every other parameter's way. */
export const FILTER_PREFIX = "f.";

/** The search-parameter name a column's filter is written under. */
export function filterParam(filterKey: string): string {
  return `${FILTER_PREFIX}${filterKey}`;
}

/** The filterable columns' keys, in column order, with duplicates dropped. */
export function filterKeysOf(columns: readonly FilterableColumn[]): string[] {
  const keys: string[] = [];
  for (const column of columns) {
    if (column.filterKey && !keys.includes(column.filterKey)) keys.push(column.filterKey);
  }
  return keys;
}

function asParams(search: string | URLSearchParams): URLSearchParams {
  return typeof search === "string" ? new URLSearchParams(search) : new URLSearchParams(search);
}

/**
 * The filters a query string is asking for, as filterKey → value.
 *
 * Every known key is present, so a caller can read `filters[key]` without a
 * `??` at each call site; a column nobody has filtered reads as "".
 */
export function readFilters(
  search: string | URLSearchParams,
  filterKeys: readonly string[],
): Record<string, string> {
  const params = asParams(search);
  const values: Record<string, string> = {};
  for (const key of filterKeys) values[key] = params.get(filterParam(key)) ?? "";
  return values;
}

/** filterKey → value, as the `f.`-prefixed changes `updateQuery` takes. */
export function filterChanges(
  values: Record<string, string>,
  filterKeys: readonly string[],
): Record<string, string> {
  const changes: Record<string, string> = {};
  for (const key of filterKeys) changes[filterParam(key)] = values[key] ?? "";
  return changes;
}

/**
 * A query string with some parameters set and others removed — an empty value
 * means "remove", so one call both sets a filter and clears the one beside it.
 * The result has no leading `?`; an empty result means the bare path.
 */
export function updateQuery(
  search: string | URLSearchParams,
  changes: Record<string, string>,
): string {
  const params = asParams(search);
  for (const [name, value] of Object.entries(changes)) {
    if (value === "") params.delete(name);
    else params.set(name, value);
  }
  return params.toString();
}

/** What the search box is actually looking for: trimmed and case-folded. */
export function searchNeedle(query: string): string {
  return query.trim().toLocaleLowerCase("en-GB");
}

/** An empty needle matches everything — a blank box is not a filter. */
export function matchesNeedle(haystack: string, needle: string): boolean {
  return needle === "" || haystack.includes(needle);
}

/** Whether any column filter is narrowing the list, for the "no match" line. */
export function anyFilterSet(values: Record<string, string>): boolean {
  return Object.values(values).some((value) => value !== "");
}

/**
 * Every value each filterable column can offer, taken from the rows themselves
 * rather than from a list somebody maintains by hand: a select that offers a
 * venue no team plays at is a select that wastes a press.
 *
 * Sorted with `localeCompare` in en-GB so "Åsa" lands beside "Anna" rather
 * than after "Zoe", and blank values are dropped — "" is the "All" option.
 */
export function gatherFacets(
  items: readonly FilterableRow[],
  filterKeys: readonly string[],
): Record<string, string[]> {
  const options: Record<string, string[]> = {};
  for (const key of filterKeys) {
    const values = new Set<string>();
    for (const item of items) {
      const value = item.facets?.[key];
      if (value) values.add(value);
    }
    options[key] = [...values].sort((a, b) => a.localeCompare(b, "en-GB"));
  }
  return options;
}

/**
 * The rows that survive the search box and every column filter.
 *
 * A column filter is an exact match on the row's facet, because the values
 * come from the rows: "Willow Park" is offered precisely because some row says
 * "Willow Park", so a substring match could only ever add surprises.
 */
export function filterRows<T extends FilterableRow>(
  items: readonly T[],
  options: { needle?: string; filters?: Record<string, string> } = {},
): T[] {
  const needle = options.needle ?? "";
  const filters = options.filters ?? {};
  const wanted = Object.entries(filters).filter(([, value]) => value !== "");
  return items.filter((item) => {
    for (const [key, value] of wanted) {
      if ((item.facets?.[key] ?? "") !== value) return false;
    }
    return matchesNeedle(item.haystack, needle);
  });
}
