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

/** CSV cell per RFC 4180 — Xero is strict about quoting. */
export function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}
