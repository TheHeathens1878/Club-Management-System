// Pure formatters for the finance section — safe to import from client
// components (no server-only imports; @/lib/finance carries the guard).

/** '00002' — the household number as printed. */
export function formatMemberNo(memberNo: number): string {
  return String(memberNo).padStart(5, "0");
}

/** '00002C' — a person's card reference. */
export function formatCardRef(memberNo: number, letter: string): string {
  return `${formatMemberNo(memberNo)}${letter}`;
}

/** 'CHG-1042' — the reference a charge carries into Xero. */
export function chargeRef(chargeNo: number): string {
  return `CHG-${chargeNo}`;
}

export const CHARGE_KIND_LABELS: Record<string, string> = {
  membership: "Membership",
  subs: "Subs",
  fine: "Fine",
  other: "Other",
};

export const CHARGE_STATUS_LABELS: Record<string, string> = {
  pending: "Outstanding",
  paid: "Paid",
  waived: "Waived",
  void: "Void",
};

/**
 * The card colourway rotates each membership year (Adam, 2026-09-04) — a
 * glance tells this season's card from last season's. Keyed on the year the
 * membership year STARTS (1 July), cycling a fixed palette, so every card in
 * a season matches and next season's is unmistakably different. Full class
 * strings on purpose: Tailwind only ships classes it can see.
 */
const CARD_COLOURWAYS = [
  "from-sky-800 via-sky-700 to-sky-500",
  "from-emerald-800 via-emerald-700 to-emerald-500",
  "from-rose-800 via-rose-700 to-rose-500",
  "from-violet-800 via-violet-700 to-violet-500",
  "from-amber-700 via-amber-600 to-amber-500",
  "from-teal-800 via-teal-700 to-teal-500",
] as const;

export function cardColourway(seasonStartYear: number): string {
  const index = ((seasonStartYear % CARD_COLOURWAYS.length) + CARD_COLOURWAYS.length) % CARD_COLOURWAYS.length;
  return CARD_COLOURWAYS[index] as string;
}

/** '1 Jul 2026 – 30 Jun 2027' from the season's date span. */
export function cardValidity(startsOn: string, endsOn: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt(startsOn)} – ${fmt(endsOn)}`;
}

/** CSV cell per RFC 4180 — Xero is strict about quoting. */
export function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}
