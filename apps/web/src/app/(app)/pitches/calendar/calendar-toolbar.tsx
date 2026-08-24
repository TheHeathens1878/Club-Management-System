"use client";

/**
 * The date picker (gap 6).
 *
 * Everything else in the toolbar — prev, next, today, the tabs, the "My teams"
 * toggle — is a plain link, because a week should be shareable. Only jumping
 * to an arbitrary date needs an input, and this is the smallest client
 * component that can turn one into a navigation.
 *
 * The current query is passed in from the server rather than read with
 * `useSearchParams`, so this component adds no suspense boundary and cannot
 * disagree with the page that rendered it.
 */

import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";

export function CalendarDatePicker({
  value,
  params,
  label = "Jump to",
}: {
  /** The date the picker shows, `YYYY-MM-DD`. */
  value: string;
  /** The query to keep, minus the date key this picker sets. */
  params: Record<string, string>;
  label?: string;
}) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="whitespace-nowrap">{label}</span>
      <Input
        type="date"
        defaultValue={value}
        aria-label="Jump to a date"
        className="h-9 w-[9.5rem]"
        onChange={(event) => {
          const next = event.target.value;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
          const query = new URLSearchParams({ ...params, date: next });
          router.push(`/pitches/calendar?${query.toString()}`);
        }}
      />
    </label>
  );
}

/** A query-carrying <select> — the team and venue filters. */
export function CalendarFilterSelect({
  label,
  paramKey,
  value,
  options,
  params,
  allLabel,
}: {
  label: string;
  paramKey: string;
  /** The currently selected value, or "" for all. */
  value: string;
  options: { value: string; label: string }[];
  /** The query to keep, minus the key this select sets. */
  params: Record<string, string>;
  allLabel: string;
}) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="whitespace-nowrap">{label}</span>
      <select
        value={value}
        aria-label={label}
        className="h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground"
        onChange={(event) => {
          const next = event.target.value;
          const query = new URLSearchParams(params);
          if (next) query.set(paramKey, next);
          else query.delete(paramKey);
          const text = query.toString();
          router.push(text ? `/pitches/calendar?${text}` : "/pitches/calendar");
        }}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "Print week" — the browser's print-to-PDF is the club's export path. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-secondary print:hidden"
    >
      Print / PDF
    </button>
  );
}
