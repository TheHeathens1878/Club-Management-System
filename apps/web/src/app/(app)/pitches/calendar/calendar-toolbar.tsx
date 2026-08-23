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
