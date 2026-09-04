import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile, isStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ChevronLeft } from "lucide-react";
import { createInternalBooking } from "../actions";
import { ContactPicker } from "./contact-picker";
import { DateTimingFields } from "./recurrence-fields";
import { FUNCTION_ROOM } from "@/lib/booking-types";

export const metadata = { title: "New internal booking" };

async function submitAction(formData: FormData): Promise<void> {
  "use server";
  const result = await createInternalBooking(formData);
  if (result?.error) throw new Error(result.error);
}

export default async function NewInternalBookingPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isStaff(session.profile?.role)) redirect("/lobby");

  const admin = createAdminClient();
  const [{ data: rooms }, { data: contacts }] = await Promise.all([
    admin
      .from("resources")
      .select("id,name")
      .eq("type", FUNCTION_ROOM)
      .eq("active", true)
      .order("sort_order"),
    admin
      .from("booking_contacts")
      .select("id,name,first_name,last_name,email,phone")
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);

  return (
    <>
      <PageHeader
        title="New internal booking"
        subtitle="Create a room booking on behalf of a customer"
        action={
          <Link
            href="/room-bookings"
            className={buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] w-full lg:min-h-0 lg:w-auto"}
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        }
      />
      <div className="max-w-2xl p-4 lg:p-6">
        <form action={submitAction} className="space-y-4 lg:space-y-6">
          <Card>
            <CardHeader><CardTitle>Room &amp; timing</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="room_id">Room *</Label>
                <select id="room_id" name="room_id" required className="min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm lg:min-h-0">
                  <option value="">Select a room…</option>
                  {(rooms ?? []).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <DateTimingFields />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Customer details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <ContactPicker contacts={contacts ?? []} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="booker_first_name">First name *</Label>
                  <Input id="booker_first_name" name="booker_first_name" required placeholder="First name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="booker_last_name">Last name *</Label>
                  <Input id="booker_last_name" name="booker_last_name" required placeholder="Last name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="booker_phone">Phone</Label>
                  <Input id="booker_phone" name="booker_phone" type="tel" placeholder="Mobile or landline" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="booker_email">Email</Label>
                  <Input id="booker_email" name="booker_email" type="email" placeholder="customer@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="occasion">Occasion / event type</Label>
                  <Input id="occasion" name="occasion" placeholder="e.g. Birthday, Wedding, Meeting" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="estimated_guests">Estimated guests</Label>
                  <Input id="estimated_guests" name="estimated_guests" type="number" min="1" placeholder="e.g. 50" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  placeholder="Any special requirements, layout preferences, catering notes…"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Payment &amp; status</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="status">Booking status</Label>
                  <select id="status" name="status" className="min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm lg:min-h-0">
                    <option value="confirmed">Confirmed</option>
                    <option value="pending">Pending (awaiting confirmation)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amount_pounds">Amount agreed (£)</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                    <Input id="amount_pounds" name="amount_pounds" type="number" min="0" step="0.01" placeholder="0.00" className="pl-7" />
                  </div>
                </div>
              </div>
              <label className="flex min-h-[44px] items-center gap-2 text-sm lg:min-h-0">
                <input type="checkbox" name="mark_paid" className="h-4 w-4 accent-primary" />
                Mark as paid
              </label>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <button
              type="submit"
              className="min-h-[44px] flex-1 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 lg:min-h-0 lg:flex-none"
            >
              Create booking
            </button>
            <Link
              href="/room-bookings"
              className={buttonVariants({ variant: "outline" }) + " min-h-[44px] flex-1 lg:min-h-0 lg:flex-none"}
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}
