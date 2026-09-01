/**
 * Which columns the People list shows, and how wide each one is.
 *
 * Adam, 2026-08-26: "We should be able to choose what columns we want to see
 * and one of them should be Membership type (linked to lead party)."
 *
 * Pure data and pure functions — imported by both the server page that renders
 * the rows and the client control that lets somebody pick, so the header, the
 * cells and the picker can never disagree about what a column is.
 *
 * The choice lives in the URL (`?cols=type,membership,teams`) rather than in
 * browser storage, because this page's whole design is that "every list is a
 * URL somebody can bookmark or send" — a column set that vanished when you
 * sent the link to a colleague would be a worse answer than no picker at all.
 */

export type PeopleColumnKey =
  | "name"
  | "type"
  | "membership"
  | "teams"
  | "contact"
  | "status"
  | "dob";

export type PeopleColumn = {
  key: PeopleColumnKey;
  label: string;
  /** Relative width, used as `<weight>fr` in the row's grid template. */
  weight: number;
  /** Shown under the label in the picker, for columns that need a word. */
  hint?: string;
  /** Name cannot be turned off: it is what the row's link is anchored on. */
  fixed?: boolean;
};

export const PEOPLE_COLUMNS: readonly PeopleColumn[] = [
  { key: "name", label: "Name", weight: 3, fixed: true },
  { key: "type", label: "Type", weight: 2, hint: "Player, coach, parent…" },
  {
    key: "membership",
    label: "Membership",
    weight: 2,
    hint: "Individual or family, and the lead contact it is billed to",
  },
  { key: "teams", label: "Teams", weight: 2, hint: "This season" },
  { key: "contact", label: "Contact", weight: 3, hint: "Through the guardian for under-18s" },
  { key: "status", label: "Status", weight: 2 },
  { key: "dob", label: "Date of birth", weight: 2 },
] as const;

/** What somebody sees before they have chosen anything. */
export const DEFAULT_PEOPLE_COLUMNS: readonly PeopleColumnKey[] = [
  "name",
  "type",
  "membership",
  "teams",
  "contact",
  "status",
] as const;

const BY_KEY = new Map(PEOPLE_COLUMNS.map((column) => [column.key, column] as const));

export function peopleColumn(key: PeopleColumnKey): PeopleColumn {
  const column = BY_KEY.get(key);
  if (!column) throw new Error(`Unknown people column: ${key}`);
  return column;
}

function isColumnKey(value: string): value is PeopleColumnKey {
  return BY_KEY.has(value as PeopleColumnKey);
}

/**
 * Read `?cols=` into a column list.
 *
 * Anything unrecognised is dropped rather than treated as an error — a stale
 * bookmark from before a column was renamed should still show a usable list.
 * The order of PEOPLE_COLUMNS wins over the order in the URL, so two people
 * with the same columns always see the same table. Name is always present, and
 * an empty or absent parameter means the default set.
 */
export function parsePeopleColumns(value: string | undefined | null): PeopleColumnKey[] {
  const asked = (value ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(isColumnKey);
  if (asked.length === 0) return [...DEFAULT_PEOPLE_COLUMNS];

  const wanted = new Set<PeopleColumnKey>(asked);
  wanted.add("name");
  return PEOPLE_COLUMNS.filter((column) => wanted.has(column.key)).map((column) => column.key);
}

/** The `?cols=` value for a chosen set, or "" when it is the default set. */
export function serialisePeopleColumns(keys: readonly PeopleColumnKey[]): string {
  const chosen = PEOPLE_COLUMNS.filter((column) => keys.includes(column.key)).map((c) => c.key);
  const isDefault =
    chosen.length === DEFAULT_PEOPLE_COLUMNS.length &&
    chosen.every((key) => DEFAULT_PEOPLE_COLUMNS.includes(key));
  return isDefault ? "" : chosen.join(",");
}

/** `gridTemplateColumns` for a row: Tailwind cannot express a runtime width. */
export function peopleGridTemplate(keys: readonly PeopleColumnKey[]): string {
  return keys.map((key) => `${peopleColumn(key).weight}fr`).join(" ");
}
