/**
 * The booking sheet's doors, as a plain module.
 *
 * These lived in `booking-sheet.tsx`, which is `"use client"`, and the record
 * page — a server component — called `deskSheetMode()` to pick the status
 * bar's door. Every export of a client module becomes a client reference the
 * moment a server component imports it, and CALLING one throws at request
 * time ("Attempted to call deskSheetMode() from the server but deskSheetMode
 * is on the client", digest 2527318018, 2026-09-16). `next build` cannot
 * catch it because the page is force-dynamic. So the helpers sit here, where
 * both halves can import them, and the sheet re-exports them for the client
 * callers that already had them.
 */

import type { BookingSheetMode as BookingActionMode } from "@/lib/booking-next-action";

/**
 * The doors this sheet has. It is the desk's list: `bookingNextAction()`'s
 * desk modes, plus `edit` and `delete`, which are gated acts no status bar
 * ever proposes.
 */
export const BOOKING_SHEET_MODES = [
  "quote",
  "confirm",
  "chase",
  "cancel",
  "payment",
  "security",
  "email",
  "edit",
  "delete",
] as const;

export type BookingSheetMode = (typeof BOOKING_SHEET_MODES)[number];

export function isBookingSheetMode(value: unknown): value is BookingSheetMode {
  return typeof value === "string" && (BOOKING_SHEET_MODES as readonly string[]).includes(value);
}

/**
 * The mode a status bar's action opens. `bookingNextAction()` also answers in
 * the booker's voice, whose `accept` / `pay` / `view` are `/portal`'s doors and
 * not the desk's, so those come back as null here.
 */
export function deskSheetMode(mode: BookingActionMode | undefined): BookingSheetMode | null {
  return mode && isBookingSheetMode(mode) ? mode : null;
}
