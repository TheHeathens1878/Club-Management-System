"use client";

/**
 * "Viewing as" — the dropdown of role–team combinations (Adam, 2026-08-25):
 *
 *   Club Admin
 *   Coach – U14 Mavericks
 *   Parent – U14 Mavericks
 *   Coach – U18 Cobras
 *   Parent – U18 Cobras
 *   Player – O45 Men
 *
 * Props come from `roleSwitcherProps()` in lib/role-view — the sidebar stays a
 * consumer:
 *
 *   const { options, current } = roleSwitcherProps(capabilities, view, scope?.id ?? null);
 *   <RoleSwitcher options={options} current={current} />
 *
 * Selecting an option calls `switchRoleView`, which re-validates against the
 * database's own answers before writing the cookies and landing on the view's
 * home. A single option renders as plain text — nothing to switch to.
 */

import { useTransition } from "react";

import { switchRoleView } from "@/app/(app)/welcome/actions";

export function RoleSwitcher({
  options,
  current,
}: {
  options: { value: string; label: string }[];
  current: string;
}) {
  const [switching, startTransition] = useTransition();

  if (options.length <= 1) {
    return (
      <span className="text-[13px] font-semibold">
        {options[0]?.label ?? "Member"}
      </span>
    );
  }

  return (
    <select
      aria-label="Viewing as"
      value={current}
      disabled={switching}
      onChange={(event) => {
        const value = event.target.value;
        if (value === current) return;
        startTransition(() => {
          void switchRoleView(value);
        });
      }}
      className="w-full cursor-pointer rounded-md border border-input bg-transparent px-2 py-1 text-[13px] font-semibold focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
