/**
 * The FA Clubs Portal export — the spreadsheet's shape (Adam, 2026-09-06).
 *
 * `clubs_portal_export()` returns one row per live player per team with both
 * emergency contacts already resolved (a linked member's own record, a
 * matching guardian, or what was typed). This module turns those rows into
 * the CSV: the column order Adam listed, dates as the Portal reads them
 * (DD/MM/YYYY), an address split into its lines, a blank cell where the club
 * holds nothing — "email (even if blank)" — and a second contact after the
 * first. Pure, so the shape is pinned by a test rather than by eye.
 */

import type { Json } from "@club/db";

import { addressToFields } from "@/lib/people-display";

export type PortalContact = {
  first_name: string | null;
  last_name: string | null;
  dob: string | null;
  sex: string | null;
  email: string | null;
  address: Json | null;
  phone: string | null;
  relationship: string | null;
  source: "linked" | "guardian" | "typed";
};

export type PortalRow = {
  team_name: string;
  first_name: string;
  last_name: string;
  dob: string | null;
  sex: string | null;
  email: string | null;
  phone: string | null;
  age_proved: boolean;
  address: Json | null;
  contact1: Json | null;
  contact2: Json | null;
};

export const PORTAL_COLUMNS: readonly string[] = [
  "Team",
  "Player first name",
  "Player last name",
  "Player date of birth",
  "Player sex",
  "Player email",
  "Age proved",
  "Player address line 1",
  "Player address line 2",
  "Player town",
  "Player county",
  "Player postcode",
  "Emergency contact first name",
  "Emergency contact last name",
  "Emergency contact date of birth",
  "Emergency contact sex",
  "Emergency contact email",
  "Emergency contact address line 1",
  "Emergency contact address line 2",
  "Emergency contact town",
  "Emergency contact county",
  "Emergency contact postcode",
  "Emergency contact mobile",
  "Emergency contact relationship",
  "Emergency contact 2 first name",
  "Emergency contact 2 last name",
  "Emergency contact 2 date of birth",
  "Emergency contact 2 sex",
  "Emergency contact 2 email",
  "Emergency contact 2 address line 1",
  "Emergency contact 2 address line 2",
  "Emergency contact 2 town",
  "Emergency contact 2 county",
  "Emergency contact 2 postcode",
  "Emergency contact 2 mobile",
  "Emergency contact 2 relationship",
];

/** `2014-03-09` → `09/03/2014`; anything else → "". */
export function portalDate(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/** `male` → `Male`; blank stays blank. */
export function portalSex(value: string | null | undefined): string {
  if (value === "male") return "Male";
  if (value === "female") return "Female";
  return "";
}

export function csvField(value: string | null | undefined): string {
  const text = value ?? "";
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function contactOf(value: Json | null): PortalContact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, Json | undefined>;
  const str = (key: string): string | null => {
    const raw = record[key];
    return typeof raw === "string" ? raw : null;
  };
  const source = str("source");
  return {
    first_name: str("first_name"),
    last_name: str("last_name"),
    dob: str("dob"),
    sex: str("sex"),
    email: str("email"),
    address: (record["address"] as Json | undefined) ?? null,
    phone: str("phone"),
    relationship: str("relationship"),
    source: source === "linked" || source === "guardian" ? source : "typed",
  };
}

function addressCells(value: Json | null): string[] {
  const a = addressToFields(value);
  return [a.line1, a.line2, a.town, a.county, a.postcode];
}

function contactCells(value: Json | null): string[] {
  const c = contactOf(value);
  if (!c) return Array.from({ length: 12 }, () => "");
  return [
    c.first_name ?? "",
    c.last_name ?? "",
    portalDate(c.dob),
    portalSex(c.sex),
    c.email ?? "",
    ...addressCells(c.address),
    c.phone ?? "",
    c.relationship ?? "",
  ];
}

/** One CSV line's cells, in `PORTAL_COLUMNS` order. */
export function portalCells(row: PortalRow): string[] {
  return [
    row.team_name,
    row.first_name,
    row.last_name,
    portalDate(row.dob),
    portalSex(row.sex),
    row.email ?? "",
    row.age_proved ? "Yes" : "No",
    ...addressCells(row.address),
    ...contactCells(row.contact1),
    ...contactCells(row.contact2),
  ];
}

/** The whole file: a BOM so Excel reads the accents, CRLF, header first. */
export function portalCsv(rows: readonly PortalRow[]): string {
  const lines = [PORTAL_COLUMNS.map(csvField).join(",")];
  for (const row of rows) lines.push(portalCells(row).map(csvField).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** "cp-under-11s-cp-ladies" or "clubs-portal" — the download's stem. */
export function portalFileStem(teamNames: readonly string[]): string {
  const stem = teamNames
    .map((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .slice(0, 4)
    .join("-");
  return stem || "clubs-portal";
}
