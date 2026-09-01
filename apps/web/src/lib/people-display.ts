/**
 * Presentation helpers shared by the people admin screens (gaps 1 and 2) and
 * the team membership editor.
 *
 * Nothing here decides anything: every safeguarding question is answered by the
 * database (`is_minor()`, the SG-4 guards) under the caller's own RLS. These
 * are labels, date formatting and the translation of a Postgres error code into
 * a sentence an administrator can act on.
 */

import type { Json } from "@club/db";
import type { PostgrestError } from "@supabase/supabase-js";

/** The name a person is known by, preferring what they asked to be called. */
export function personLabel(person: {
  first_name: string;
  last_name: string;
  preferred_name?: string | null;
}): string {
  return `${person.preferred_name || person.first_name} ${person.last_name}`.trim();
}

/**
 * Mirrors `public.is_minor_dob(date)` for badge rendering only.
 *
 * SG-0 / Open Decision D1: an unknown date of birth is a MINOR, not "unknown,
 * so skip the check". Adulthood starts on the 18th birthday itself. A leap-day
 * birth reaches its anniversary on 1 March in a non-leap year, which is what
 * both this and the SQL do.
 */
export function isMinorDob(dob: string | null | undefined): boolean {
  if (!dob) return true;
  const parts = dob.split("-").map((p) => Number(p));
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) return true;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return true;
  const eighteenth = new Date(Date.UTC(year + 18, month - 1, day));
  const today = new Date();
  const midnightToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return eighteenth.getTime() > midnightToday;
}

/** A plain date column (`YYYY-MM-DD`) as a human reads it. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const at = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A timestamptz as a human reads it, in the club's timezone. */
export function formatStamp(value: string | null | undefined): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** Today in Europe/London as `YYYY-MM-DD`, for a date input's default. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// people.address
// ---------------------------------------------------------------------------
// The column is jsonb precisely so the shape can move without a migration
// (P1.1 §2). These are the recommended keys the migration names.

export const ADDRESS_KEYS = ["line1", "line2", "town", "county", "postcode", "country"] as const;
export type AddressKey = (typeof ADDRESS_KEYS)[number];
export type AddressFields = Record<AddressKey, string>;

export const ADDRESS_LABELS: Record<AddressKey, string> = {
  line1: "Address line 1",
  line2: "Address line 2",
  town: "Town or city",
  county: "County",
  postcode: "Postcode",
  country: "Country",
};

export function addressToFields(value: Json | null | undefined): AddressFields {
  const empty = {
    line1: "",
    line2: "",
    town: "",
    county: "",
    postcode: "",
    country: "",
  } satisfies AddressFields;
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const record = value as Record<string, Json | undefined>;
  const out = { ...empty };
  for (const key of ADDRESS_KEYS) {
    const raw = record[key];
    out[key] = typeof raw === "string" ? raw : "";
  }
  return out;
}

/** Only the keys that were filled in, or NULL when the whole block is empty. */
export function addressFromFields(fields: AddressFields): Json | null {
  const out: Record<string, string> = {};
  for (const key of ADDRESS_KEYS) {
    const value = fields[key].trim();
    if (value) out[key] = value;
  }
  return Object.keys(out).length === 0 ? null : (out as Json);
}

export function addressOneLine(value: Json | null | undefined): string {
  const fields = addressToFields(value);
  const parts = ADDRESS_KEYS.map((k) => fields[k]).filter((v) => v !== "");
  return parts.length === 0 ? "—" : parts.join(", ");
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Turn a PostgREST failure into something an administrator can act on.
 *
 * 42501 is RLS refusing the write outright — the caller does not hold the role
 * the policy asks for, and the raw message says nothing useful.
 *
 * P0001 is a safeguarding guard speaking (SG-4 on `guardianships`, the dob
 * guard on `people`). Those messages are written for a human and name the
 * exact link or record at fault, so they are shown VERBATIM and never
 * rewritten.
 */
export function friendlyDbError(
  error: PostgrestError,
  refusal: string,
  duplicate?: string,
): string {
  if (error.code === "42501") return refusal;
  if (error.code === "P0001") return error.message;
  if (error.code === "23505" && duplicate) return duplicate;
  return error.message;
}

/**
 * PostgREST wraps `ilike` patterns in a comma-separated `or=` list, so a comma
 * or a parenthesis in the search box would be read as filter syntax; `%` and
 * `_` are `ilike` wildcards, and a trailing backslash escapes the terminator.
 * None of them belong in a name, so they are dropped rather than escaped.
 */
export function sanitiseSearch(raw: string): string {
  return raw
    .replace(/[,()%_]/g, " ")
    .replace(/\\/g, " ")
    .trim()
    .slice(0, 80);
}
