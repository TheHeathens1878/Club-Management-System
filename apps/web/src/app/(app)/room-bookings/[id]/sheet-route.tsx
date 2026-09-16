"use client";

/**
 * `?sheet=<mode>` is what the booking record's doors open (P8.1b).
 *
 * The sheet itself is controlled — it takes a `mode` and an `onClose` and owns
 * neither — because the desk list (P8.2) opens the same component from a row's
 * own state. On the record page the state belongs in the URL instead, and that
 * buys three things the old inline panels never had:
 *
 *   · it survives a server-action refresh, because the URL is not React state;
 *   · a link can land somebody on the door they need ("Set the price and terms"
 *     in a reminder email goes straight to `?sheet=confirm`);
 *   · Back closes the sheet, which is what Back means on a phone.
 *
 * An unknown or misspelt `?sheet=` is simply no sheet, never a crash.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { BookingSheet, isBookingSheetMode, type BookingSheetProps } from "../booking-sheet";

export function BookingSheetRoute(props: Omit<BookingSheetProps, "mode" | "onClose">) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("sheet");
  const mode = isBookingSheetMode(raw) ? raw : null;

  return (
    <BookingSheet
      {...props}
      mode={mode}
      // `replace`, not `push`: the door being shut is not a place worth a second
      // entry in the history, and `scroll: false` keeps the page where the desk
      // left it rather than jumping to the top on every close.
      onClose={() => router.replace(pathname, { scroll: false })}
    />
  );
}
