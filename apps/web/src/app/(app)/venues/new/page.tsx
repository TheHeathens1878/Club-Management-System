import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";

import { NewVenueForm } from "../venue-forms";

export const metadata = { title: "Add a venue" };

/**
 * `/venues/new` — a new ground.
 *
 * Same guard as the list. `venues_admin_insert` asks `is_club_admin()` and is
 * what actually decides; this only saves a committee-less sign-in the trip.
 */
export default async function NewVenuePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/lobby");

  return (
    <>
      <PageHeader
        title="Add a venue"
        subtitle="A ground the club plays at"
        action={
          <Link href="/venues" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ChevronLeft className="h-4 w-4" /> Venues
          </Link>
        }
      />
      <div className="max-w-3xl space-y-6 p-4 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Venue details</CardTitle>
            <p className="text-sm text-muted-foreground">
              Only the name is required. Saving it creates the ground&rsquo;s coaches group at the
              same time — every coach whose team plays here joins it, and keeps joining as teams
              move — so add its pitches next and the group fills itself.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <NewVenueForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
