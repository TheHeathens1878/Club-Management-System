import type { Database } from "@club/db";

import { instantsToLocalWindow } from "@/lib/booking-time";

/**
 * Shorthands for the P1.5 unified booking tables, so pages and actions can
 * name a row shape without repeating the generated-type path.
 */

export type ResourceRow = Database["public"]["Tables"]["resources"]["Row"];
export type ResourceInsert = Database["public"]["Tables"]["resources"]["Insert"];
export type ResourceUpdate = Database["public"]["Tables"]["resources"]["Update"];

export type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];
export type BookingInsert = Database["public"]["Tables"]["bookings"]["Insert"];
export type BookingUpdate = Database["public"]["Tables"]["bookings"]["Update"];

export type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
export type PaymentInsert = Database["public"]["Tables"]["payments"]["Insert"];

export type BookingCommRow = Database["public"]["Tables"]["booking_comms"]["Row"];

export type BookingStatus = Database["public"]["Enums"]["booking_status"];
export type BookingKind = Database["public"]["Enums"]["booking_kind"];
export type BookingPaymentStatus = Database["public"]["Enums"]["payment_status"];
export type ResourceType = Database["public"]["Enums"]["resource_type"];

/** The `resources` rows this app manages: function rooms, never pitches. */
export const FUNCTION_ROOM: ResourceType = "function_room";

/** A room as the room pickers and public pages need it. */
export type RoomOption = { id: string; name: string };

/**
 * One booking as the staff list, calendar and exports render it.
 *
 * The UI works in Europe/London wall clock, so the timestamptz period is
 * flattened back to the date + start + end the screens have always shown.
 */
export type BookingListItem = {
  id: string;
  resource_id: string;
  date: string;
  start_time: string;
  end_time: string;
  booker_name: string;
  booker_email: string;
  booker_phone: string | null;
  occasion: string | null;
  estimated_guests: number | null;
  status: BookingStatus;
  payment_status: BookingPaymentStatus;
  total_pence: number | null;
  kind: BookingKind;
  recurrence_group_id: string | null;
};

/** The columns {@link toBookingListItem} needs, for a `.select()` string. */
export const BOOKING_LIST_SELECT =
  "id,resource_id,starts_at,ends_at,booker_name,booker_email,booker_phone,occasion,estimated_guests,status,payment_status,total_pence,kind,recurrence_group_id";

export function toBookingListItem(
  row: Pick<
    BookingRow,
    | "id"
    | "resource_id"
    | "starts_at"
    | "ends_at"
    | "booker_name"
    | "booker_email"
    | "booker_phone"
    | "occasion"
    | "estimated_guests"
    | "status"
    | "payment_status"
    | "total_pence"
    | "kind"
    | "recurrence_group_id"
  >,
): BookingListItem {
  const window = instantsToLocalWindow(row.starts_at, row.ends_at);
  return {
    id: row.id,
    resource_id: row.resource_id,
    date: window.date,
    start_time: window.startTime,
    end_time: window.endTime,
    booker_name: row.booker_name,
    booker_email: row.booker_email,
    booker_phone: row.booker_phone,
    occasion: row.occasion,
    estimated_guests: row.estimated_guests,
    status: row.status,
    payment_status: row.payment_status,
    total_pence: row.total_pence,
    kind: row.kind,
    recurrence_group_id: row.recurrence_group_id,
  };
}

/**
 * The period columns of a `bookings` insert.
 *
 * `blocked_from` / `blocked_until` are NOT NULL and maintained by
 * `trg_bookings_compute_blocked`, which overwrites whatever a client supplies.
 * The generated Insert type still demands them, so every insert passes the
 * unbuffered window — precisely what the trigger computes while both buffers
 * are 0, which is the case for every booking this app creates.
 */
export function bookingPeriod(
  startsAt: string,
  endsAt: string,
): Pick<BookingInsert, "starts_at" | "ends_at" | "blocked_from" | "blocked_until"> {
  return {
    starts_at: startsAt,
    ends_at: endsAt,
    blocked_from: startsAt,
    blocked_until: endsAt,
  };
}
