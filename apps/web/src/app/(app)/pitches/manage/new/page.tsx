import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";

import { NewPitchForm } from "./new-pitch-form";

export const metadata = { title: "Add a pitch" };

/**
 * `/pitches/manage/new` — a new pitch.
 *
 * Same guard as the list. `resources_admin_insert` asks `is_club_admin()` and
 * is what actually decides; this only saves a committee-less sign-in the trip.
 */
export default async function NewPitchPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/lobby");

  return (
    <>
      <PageHeader
        title="Add a pitch"
        subtitle="A new bookable pitch, added at the end of the running order"
        action={
          <Link
            href="/pitches/manage"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ChevronLeft className="h-4 w-4" /> Manage pitches
          </Link>
        }
      />
      <div className="max-w-3xl space-y-6 p-4 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Pitch details</CardTitle>
            <p className="text-sm text-muted-foreground">
              Only the name is required. Everything else can be filled in later from the pitch
              list — and a pitch that turns out to be a mistake is taken out of use rather than
              deleted, because bookings reference it.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <NewPitchForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
