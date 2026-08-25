import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { ManagePitchesPanel, type PitchAdminRow } from "./manage-panel";

/**
 * `/pitches/manage` — the club's pitches as records, not as a diary (gap 7).
 *
 * Read through the caller's own client. `resources_public_read` returns the
 * active rows to anyone and `resources_admin_read` adds the retired ones for a
 * club administrator, so the out-of-use pitches appearing here at all is the
 * database confirming who is asking. The guard below mirrors /people: the
 * committee sign-in or the `person_roles` club_admin.
 *
 * Nothing here touches the hire pricing columns. `resources` carries them for
 * the function room; a pitch leaves them NULL and /room-bookings/rooms is
 * where they are set.
 */
export default async function ManagePitchesPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/room-bookings");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resources")
    .select(
      "id,name,description,information,capacity,active,sort_order,default_pre_buffer_minutes,default_post_buffer_minutes,legacy_neon_pitch_id",
    )
    .eq("type", "pitch")
    .order("sort_order")
    .order("name");

  const rows = data ?? [];

  // How much is still riding on each pitch, so "take out of use" is an
  // informed click. Cancelled bookings are not counted: they hold no slot.
  const { data: upcoming } = await supabase
    .from("bookings")
    .select("resource_id")
    .in("resource_id", rows.length > 0 ? rows.map((row) => row.id) : ["00000000-0000-0000-0000-000000000000"])
    .neq("status", "cancelled")
    .gte("ends_at", new Date().toISOString());

  const bookingCount = new Map<string, number>();
  for (const booking of upcoming ?? []) {
    bookingCount.set(booking.resource_id, (bookingCount.get(booking.resource_id) ?? 0) + 1);
  }

  const pitches: PitchAdminRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    information: row.information,
    capacity: row.capacity,
    active: row.active,
    defaultPreBufferMinutes: row.default_pre_buffer_minutes,
    defaultPostBufferMinutes: row.default_post_buffer_minutes,
    legacyId: row.legacy_neon_pitch_id,
    upcomingBookings: bookingCount.get(row.id) ?? 0,
  }));

  return (
    <>
      <PageHeader
        title="Manage pitches"
        subtitle="The pitches the club books — their names, their changeover buffers and the order they appear in"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/pitches" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ChevronLeft className="h-4 w-4" /> Pitches
            </Link>
            <Link href="/pitches/manage/new" className={buttonVariants({ size: "sm" })}>
              <Plus className="h-4 w-4" /> Add a pitch
            </Link>
          </div>
        }
      />
      <div className="space-y-6 p-6">
        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load the pitches: {error.message}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {pitches.length} {pitches.length === 1 ? "pitch" : "pitches"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              The order here is the order the booking form, the weekend grid and the calendar use.
              A pitch is never deleted — the club&apos;s bookings point at it, and the database
              refuses to remove a row they still reference. Taking one out of use stops it being
              offered and leaves every booking already made against it exactly as it was.
            </p>
          </CardHeader>
          <CardContent>
            <ManagePitchesPanel pitches={pitches} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
