import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, MessageSquare } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin, nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { EditVenueForm, RetireVenueForm } from "../venue-forms";
import { AttachPitchForm, DetachPitchForm } from "./pitch-venue-forms";

/**
 * `/venues/[id]` — one ground: what it is, which pitches are on it, and who
 * its coaches' group has in it.
 *
 * The coaching staff panel is the interesting half. Membership of a venue's
 * group is DERIVED (20260901190000) — every coach, assistant coach and manager
 * of an active team that plays here, by home pitch, by an allocated fixture or
 * by a training session — and adults only, strictly: SG-0 makes an unknown
 * date of birth a minor, and a minor is not admitted at all. So a coach can be
 * correctly identified as working here and still be out of the group, and the
 * only honest thing to do is say which ones and why. `venue_coaching_staff()`
 * answers exactly that question, which is why it returns `adult` and
 * `in_group` as separate columns.
 */

export const dynamic = "force-dynamic";

export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/lobby");

  const { id } = await params;
  const supabase = await createClient();

  const { data: venue } = await supabase
    .from("venues")
    .select("id,name,address,notes,active,sort_order")
    .eq("id", id)
    .maybeSingle();
  if (!venue) notFound();

  const [{ data: pitchRows }, { data: groupId }, { data: staffRows }] = await Promise.all([
    supabase
      .from("resources")
      .select("id,name,active,venue_id,venues(name)")
      .eq("type", "pitch")
      .order("sort_order")
      .order("name"),
    supabase.rpc("venue_coaches_group_id", { p_venue_id: id }),
    supabase.rpc("venue_coaching_staff", { p_venue_id: id }),
  ]);

  const pitches = pitchRows ?? [];
  const here = pitches.filter((pitch) => pitch.venue_id === id);
  const elsewhere = pitches
    .filter((pitch) => pitch.venue_id !== id && pitch.active)
    .map((pitch) => ({
      id: pitch.id,
      name: pitch.name,
      currentVenue: pitch.venues?.name ?? null,
    }));

  const staff = staffRows ?? [];
  const staffNames = await resolveNames(staff.map((row) => row.person_id));
  const inGroup = staff.filter((row) => row.in_group);
  const waiting = staff.filter((row) => !row.in_group);

  return (
    <>
      <PageHeader
        title={venue.name}
        subtitle={venue.address || "No address recorded"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {groupId && (
              <Link
                href={`/messages/${groupId}`}
                className={buttonVariants({ variant: "outline", size: "sm" }) + " gap-1.5"}
              >
                <MessageSquare className="h-3.5 w-3.5" /> Coaches group
              </Link>
            )}
            <Link href="/venues" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ChevronLeft className="h-4 w-4" /> Venues
            </Link>
          </div>
        }
      />

      <div className="max-w-3xl space-y-4 p-4 lg:space-y-6 lg:p-6">
        {!venue.active && (
          <div className="rounded-lg border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
            This venue is retired. Its pitches still book and its coaches group is still readable —
            nothing here was deleted, and bringing it back into use is one button below.
          </div>
        )}

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">The ground</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <EditVenueForm
              venueId={venue.id}
              values={{
                name: venue.name,
                address: venue.address,
                notes: venue.notes,
                sortOrder: venue.sort_order,
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">
              Pitches on this ground ({here.length})
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Which pitches are here is what decides who is in the coaches group: a team&rsquo;s home
              pitch, a fixture allocated to one, or a training session on one all count as playing
              here. Moving a pitch moves those coaches with it.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0 lg:p-6 lg:pt-0">
            {here.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pitches on this ground yet, so nothing links a team to it and the coaches group
                is empty.
              </p>
            ) : (
              <div className="space-y-2">
                {here.map((pitch) => (
                  <div
                    key={pitch.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href="/pitches/manage"
                        className="text-sm font-medium underline underline-offset-2 hover:text-primary"
                      >
                        {pitch.name}
                      </Link>
                      {!pitch.active && <Badge variant="outline">Out of use</Badge>}
                    </div>
                    <DetachPitchForm venueId={venue.id} pitch={pitch} />
                  </div>
                ))}
              </div>
            )}

            <AttachPitchForm venueId={venue.id} candidates={elsewhere} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Coaches here ({inGroup.length})</CardTitle>
            <p className="text-sm text-muted-foreground">
              Worked out from the teams that play here, and kept in step on its own. Nobody is
              added or removed by hand.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0">
            {inGroup.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody yet. A coach appears here as soon as one of their teams has a home pitch, a
                fixture or a training session on this ground.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {inGroup.map((row) => (
                  <Badge key={row.person_id} variant="muted">
                    {nameOf(staffNames, row.person_id)}
                  </Badge>
                ))}
              </div>
            )}

            {/* The ones the group will not take. Named rather than quietly
                absent: every one of them is a date of birth the club has not
                got, and that is a thing an administrator can actually fix. */}
            {waiting.length > 0 && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-sm font-medium text-amber-900">
                  {waiting.length === 1
                    ? "One coach here is not in the group"
                    : `${waiting.length} coaches here are not in the group`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {waiting.map((row) => (
                    <Link key={row.person_id} href={`/people/${row.person_id}`}>
                      <Badge variant="outline" className="hover:bg-secondary">
                        {nameOf(staffNames, row.person_id)}
                      </Badge>
                    </Link>
                  ))}
                </div>
                <p className="text-xs text-amber-900/80">
                  A venue&rsquo;s coaches group admits adults only, and the club counts an unknown
                  date of birth as a minor. Each of these is waiting on a date of birth — they join
                  the moment the club has one, and the app asks them for it at their next sign-in.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Retire this venue</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <RetireVenueForm venueId={venue.id} active={venue.active} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
