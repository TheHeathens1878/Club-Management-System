/**
 * Splitting a one-string contact name into a first name and a last name
 * (Adam, 2026-08-26: "For all contacts, first name and last name are
 * separate").
 *
 * The mirror of `contact_name_first()` / `contact_name_last()` in migration
 * 20260825491000, and it must stay a mirror: the database splits the legacy
 * rows with those, the app splits anything still arriving as one string with
 * this, and a disagreement between the two would show up as a name that
 * changes shape when it crosses the boundary.
 *
 * THE RULE: collapse runs of whitespace, then split on the LAST space. The
 * token after it is the last name; everything before it is the first name, so
 * "Mary Jane Watson" keeps "Mary Jane". A name with no space at all cannot be
 * split, so the whole of it stays in the first name and the last name is left
 * BLANK — never "(unknown)", never a guess. Somebody can correct it on the
 * screen; nobody can un-invent a surname the software made up.
 *
 * Pure functions, no imports: safe in client components and server actions
 * alike.
 */

export type ContactNameParts = { firstName: string; lastName: string };

/** Collapse whitespace runs and trim, the way the SQL side does. */
function tidy(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim();
}

/** Split a one-string name on its last space. See the rule above. */
export function splitContactName(name: string | null | undefined): ContactNameParts {
  const clean = tidy(name);
  const cut = clean.lastIndexOf(" ");
  if (cut < 0) return { firstName: clean, lastName: "" };
  return { firstName: clean.slice(0, cut).trim(), lastName: clean.slice(cut + 1).trim() };
}

/** The display name the generated columns hold: both parts, one space, trimmed. */
export function joinContactName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return `${tidy(firstName)} ${tidy(lastName)}`.trim();
}
