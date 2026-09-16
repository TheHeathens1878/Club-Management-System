"use client";

import { Fragment, isValidElement, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Search } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Input, Label } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  anyFilterSet,
  filterChanges,
  filterKeysOf,
  filterParam,
  filterRows,
  gatherFacets,
  searchNeedle,
  updateQuery,
} from "@/lib/data-list";
import { cn } from "@/lib/utils";

/**
 * One list, two shapes: a dense table at `lg`, a stack of cards on a phone,
 * filtered once so the two can never disagree about what is being shown.
 *
 * It generalises the teams list, which was the best list in the app and was
 * trapped in its own route: column filters, a search box that filters as you
 * type, a tick column with a bulk bar, a phone twin, an empty state and a
 * footer — all written once. Twenty other lists were written twice, as a table
 * and again as cards, which is exactly how two presentations of the same rows
 * drift apart.
 *
 * WHAT ARRIVES RENDERED. A row's `cells` are the `<td>`s themselves and its
 * `card` is the whole phone card, both built by the SERVER page that already
 * knows how to say a staff name, a subs pill or a kick-off time. This frame
 * never looks inside them. That is the point: a server page keeps rendering
 * its own content and hands over only the chrome, so adopting the frame costs
 * no queries and no round trips.
 *
 * WHAT FILTERING IS. The search box and the column filters narrow the rows the
 * server ALREADY SENT — no query runs, nothing is fetched. They belong to a
 * list that is sent whole. A paginated list (People sends twenty-five rows of
 * several hundred) must leave `search` off and its columns `filterKey`-less,
 * and filter on the server instead, or it will tell somebody a member does not
 * exist. The filters are still URLs: they are mirrored into `?f.<filterKey>=`
 * with `replaceState`, so a narrowed list can be sent to a colleague, while
 * Back leaves the page rather than walking letter by letter through a search.
 */

export type DataColumn = {
  /** Stable key for React, and what `?cols=`-style pickers name the column. */
  key: string;
  label: string;
  /** The small second line under the label — "from age group". */
  sub?: string;
  /** Relative width; the columns become a `<colgroup>` of percentages. */
  weight?: number;
  align?: "left" | "right";
  /** Set, the column gets a filter reading this key out of each row's facets. */
  filterKey?: string;
  /** The filter's everything option — "All ages" reads better than "All". */
  allLabel?: string;
};

export type DataItem = {
  key: string;
  /** Everything the search box looks at, already lower-cased. */
  haystack: string;
  /** filterKey → this row's value, for the column filters. */
  facets?: Record<string, string>;
  /** The row's `<td>`s only — the frame owns the `<tr>`, so it can add a tick. */
  cells: ReactNode;
  /** The same row as a phone card. Without one the frame stacks the cells. */
  card?: ReactNode;
  /** Faded, for a row that is on the books but not in play — an ex-team. */
  dim?: boolean;
};

export type DataListFrameProps = {
  items: readonly DataItem[];
  columns: readonly DataColumn[];
  /**
   * The filter-as-you-type box. `param` is the URL parameter it mirrors into
   * (`q` everywhere so far) and `initial` is what the server rendered with.
   * Leave it off for a list the server filters.
   */
  search?: { param: string; placeholder: string; initial: string };
  /** The caller's own filter pills, above the box — `ChipStrip` of chips. */
  chips?: ReactNode;
  /**
   * Tick mode. `bar` is handed the ticked keys and a way to clear them, and
   * returns the bulk bar to show above the list; it is called only while
   * something is ticked. A function prop, so `select` can only come from a
   * client component — a server page cannot hand a function across.
   */
  select?: { label: string; bar: (keys: string[], clear: () => void) => ReactNode };
  /** Shown when there are no rows AT ALL, as opposed to none matching. */
  empty: {
    title: string;
    body?: ReactNode;
    /** Rendered, never a component: `icon={<Users className="h-5 w-5" />}`. */
    icon?: ReactNode;
    action?: { href: string; label: string };
  };
  /** Shown when there are rows but the filters hide every one of them. */
  noMatch?: string;
  /** Server-rendered controls beside the search box — a "New team" button. */
  actions?: ReactNode;
  /** The quiet line under the table, right-aligned. */
  footerNote?: ReactNode;
  /**
   * The "Show the other 6 teams" press in the footer, for rows the page is
   * holding back. A server page gives it an `href`; a client caller may give
   * it an `onShow` instead.
   */
  showMore?: { label: string; href?: string; onShow?: () => void };
};

/**
 * The fallback phone card, for a row that did not bring one.
 *
 * A row's cells are `<td>`s and a `<td>` cannot live outside a table, so this
 * reads each cell's children back out and stacks them against their column's
 * label. It is a safety net, not the design: give the item a `card` and it is
 * never reached.
 */
function cellChildren(cells: ReactNode): ReactNode[] {
  // The documented shape is a fragment of <td>s; unwrap it to reach them.
  const node = isValidElement(cells) ? cells : null;
  const inner =
    node && node.type === Fragment ? (node.props as { children?: ReactNode }).children : cells;
  const list = Array.isArray(inner) ? inner : [inner];
  return list.map((cell) =>
    isValidElement(cell) ? ((cell.props as { children?: ReactNode }).children ?? null) : cell,
  );
}

function StackedCard({ cells, columns }: { cells: ReactNode; columns: readonly DataColumn[] }) {
  const bodies = cellChildren(cells);
  return (
    <dl className="space-y-1 px-4 py-3 text-sm">
      {columns.map((column, index) => (
        <div key={column.key} className="flex gap-3">
          <dt className="w-24 shrink-0 text-xs text-muted-foreground">{column.label}</dt>
          <dd className="min-w-0 flex-1">{bodies[index] ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataListFrame({
  items,
  columns,
  search,
  chips,
  select,
  empty,
  noMatch = "Nothing matches those filters.",
  actions,
  footerNote,
  showMore,
}: DataListFrameProps) {
  const params = useSearchParams();
  const filterKeys = useMemo(() => filterKeysOf(columns), [columns]);

  const [query, setQuery] = useState(search?.initial ?? "");
  // Read once, from the URL the page was opened on: after that the filters are
  // this component's state and `replaceState` keeps the URL following them.
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const key of filterKeys) initial[key] = params.get(filterParam(key)) ?? "";
    return initial;
  });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const facets = useMemo(() => gatherFacets(items, filterKeys), [items, filterKeys]);
  const filtering = anyFilterSet(filters);

  const shown = useMemo(
    () => filterRows(items, { needle: searchNeedle(query), filters }),
    [items, query, filters],
  );

  /** Mirror the box and the filters into the URL without a round trip. */
  function mirror(changes: Record<string, string>) {
    const next = updateQuery(window.location.search, changes);
    window.history.replaceState(null, "", next ? `?${next}` : window.location.pathname);
  }

  function onQuery(value: string) {
    setQuery(value);
    if (search) mirror({ [search.param]: value.trim() });
  }

  function onFilter(key: string, value: string) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    mirror(filterChanges(next, filterKeys));
  }

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllShown() {
    setSelected((current) => {
      const everyShown = shown.length > 0 && shown.every((item) => current.has(item.key));
      const next = new Set(current);
      if (everyShown) for (const item of shown) next.delete(item.key);
      else for (const item of shown) next.add(item.key);
      return next;
    });
  }

  const filterable = columns.filter(
    (column): column is DataColumn & { filterKey: string } => !!column.filterKey,
  );

  const filterSelect = (column: DataColumn & { filterKey: string }) => (
    <select
      value={filters[column.filterKey] ?? ""}
      onChange={(event) => onFilter(column.filterKey, event.target.value)}
      aria-label={`Filter by ${column.label.toLocaleLowerCase("en-GB")}`}
      className="touch h-8 w-full min-w-0 rounded-md border bg-background px-1.5 text-xs font-normal normal-case tracking-normal"
    >
      <option value="">{column.allLabel ?? "All"}</option>
      {(facets[column.filterKey] ?? []).map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );

  const totalWeight = columns.reduce((sum, column) => sum + (column.weight ?? 1), 0);

  return (
    <>
      {(search || chips || actions) && (
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
            {search && (
              <div className="space-y-1.5">
                <Label htmlFor="data-list-search" className="sr-only">
                  {search.placeholder}
                </Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="data-list-search"
                    value={query}
                    onChange={(event) => onQuery(event.target.value)}
                    placeholder={search.placeholder}
                    autoComplete="off"
                    className="touch w-full pl-9 sm:w-64"
                  />
                </div>
              </div>
            )}
            {chips}
          </div>
          {actions}
        </div>
      )}

      {select && selected.size > 0 && select.bar([...selected], () => setSelected(new Set()))}

      {items.length === 0 ? (
        <EmptyState icon={empty.icon} title={empty.title} action={empty.action}>
          {empty.body}
        </EmptyState>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          {filtering || query.trim() !== "" ? noMatch : empty.title}
        </div>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          {/* The phone reads the same rows as a stack of cards, with the same
              column filters folded into one sheet rather than a header row. */}
          <div className="lg:hidden">
            {filterable.length > 0 && (
              <details className="border-b">
                <summary className="touch cursor-pointer list-none px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  Filter columns{filtering ? ` · showing ${shown.length}` : ""}
                </summary>
                <div className="grid grid-cols-2 gap-2 p-3 pt-0">
                  {filterable.map((column) => (
                    <label key={column.key} className="space-y-1 text-xs text-muted-foreground">
                      {column.label}
                      {filterSelect(column)}
                    </label>
                  ))}
                </div>
              </details>
            )}
            <ul className="divide-y">
              {shown.map((item) => (
                <li
                  key={item.key}
                  className={cn("flex items-start", item.dim && "opacity-60")}
                >
                  {select && (
                    /* The tick is a 44px target on a phone without a 44px
                       checkbox: the real input fills the label invisibly and
                       the box somebody sees is drawn beside it. */
                    <label className="touch relative flex w-11 shrink-0 items-start justify-center pt-3.5">
                      <input
                        type="checkbox"
                        checked={selected.has(item.key)}
                        onChange={() => toggle(item.key)}
                        aria-label={select.label}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                      <span
                        aria-hidden
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded border bg-background",
                          selected.has(item.key) && "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        {selected.has(item.key) && <Check className="h-3.5 w-3.5" />}
                      </span>
                    </label>
                  )}
                  <span className="min-w-0 flex-1">
                    {item.card ?? <StackedCard cells={item.cells} columns={columns} />}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <Table>
              {/* Column widths as percentages of the caller's weights: a
                  `<col>` is the only way to size a column whose cells the
                  frame never sees. */}
              <colgroup>
                {select && <col className="w-10" />}
                {columns.map((column) => (
                  <col
                    key={column.key}
                    style={{ width: `${((column.weight ?? 1) / totalWeight) * 100}%` }}
                  />
                ))}
              </colgroup>
              <THead>
                <tr>
                  {select && (
                    <TH className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={shown.length > 0 && shown.every((item) => selected.has(item.key))}
                        onChange={toggleAllShown}
                        aria-label={`${select.label} — every row shown`}
                        className="h-4 w-4"
                      />
                    </TH>
                  )}
                  {columns.map((column) => (
                    <TH
                      key={column.key}
                      className={cn("py-2.5", column.align === "right" && "text-right")}
                    >
                      {column.label}
                      {column.sub && (
                        <span className="block font-normal normal-case tracking-normal text-muted-foreground/80">
                          {column.sub}
                        </span>
                      )}
                    </TH>
                  ))}
                </tr>
                {filterable.length > 0 && (
                  <tr className="border-t bg-secondary/20">
                    {select && <td className="px-3 py-2" />}
                    {columns.map((column) => (
                      <td key={column.key} className="px-4 py-2">
                        {column.filterKey
                          ? filterSelect(column as DataColumn & { filterKey: string })
                          : null}
                      </td>
                    ))}
                  </tr>
                )}
              </THead>
              <TBody>
                {shown.map((item) => (
                  <TR key={item.key} className={cn(item.dim && "opacity-60")}>
                    {select && (
                      <TD className="px-3">
                        <input
                          type="checkbox"
                          checked={selected.has(item.key)}
                          onChange={() => toggle(item.key)}
                          aria-label={select.label}
                          className="h-4 w-4"
                        />
                      </TD>
                    )}
                    {item.cells}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          {(showMore || footerNote) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs">
              {showMore ? (
                showMore.href ? (
                  <Link
                    href={showMore.href}
                    className="touch inline-flex items-center font-medium text-primary hover:underline"
                  >
                    {showMore.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="touch inline-flex items-center font-medium text-primary hover:underline"
                    onClick={showMore.onShow}
                  >
                    {showMore.label}
                  </button>
                )
              ) : (
                <span />
              )}
              {footerNote && <span className="text-muted-foreground">{footerNote}</span>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
