import type { Enums } from "@club/db";

export type MemberStatus = "current" | "lapsed" | "deceased" | "resigned";

/**
 * Every role value this app has to cope with — the database's `user_role`
 * enum, which since 20260905120000 carries `booker` itself. Derived from the
 * generated enum so a value added in a migration cannot go unhandled here.
 */
export type UserRole = Enums<"user_role">;
export type PaymentMethod = "cash" | "card" | "bar" | "stripe";

/** A function-room hirer's login: the portal, and nothing of the club's. */
export function isBookerRole(role: UserRole | null | undefined): boolean {
  return role === "booker";
}

export interface MembershipCategory {
  id: string;
  name: string;
  price_pence: number;
  active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  member_no: number | null;
  title: string | null;
  first_name: string | null;
  middle_name: string | null;
  surname: string | null;
  known_as: string | null;
  sex: string | null;
  address1: string | null;
  address2: string | null;
  area: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
  landline: string | null;
  mobile: string | null;
  email: string | null;
  dob: string | null;
  occupation: string | null;
  date_joined: string | null;
  date_lapsed: string | null;
  proposed_by: string | null;
  seconded_by: string | null;
  category_id: string | null;
  status: MemberStatus;
  archived: boolean;
  consent_contact: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberWithCategory extends Member {
  category: MembershipCategory | null;
}

export interface Payment {
  id: string;
  member_id: string;
  amount_pence: number;
  method: PaymentMethod;
  period_year: number;
  recorded_by: string | null;
  recorded_at: string;
  notes: string | null;
  stripe_ref: string | null;
}

export interface Profile {
  id: string;
  /**
   * Not a column on `profiles` in the current schema — the imported P0.4 app
   * carried it over from an older one, and nothing reads it. Optional so a row
   * from the typed client satisfies this interface.
   */
  member_id?: string | null;
  role: UserRole;
  full_name: string | null;
  created_at: string;
}
