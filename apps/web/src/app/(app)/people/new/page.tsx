import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { addressToFields } from "@/lib/people-display";

import { PersonForm } from "../person-form";

export default async function NewPersonPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/room-bookings");

  return (
    <>
      <PageHeader
        title="Add a person"
        subtitle="One row per human — a player, a coach, a parent or a hirer"
        action={
          <Link
            href="/people"
            className={
              buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] lg:min-h-0"
            }
          >
            <ChevronLeft className="h-4 w-4" /> Back to people
          </Link>
        }
      />
      <div className="max-w-3xl p-4 lg:p-6">
        <Card>
          <CardContent className="p-4 pt-4 lg:p-6 lg:pt-6">
            <PersonForm
              mode="create"
              values={{
                first_name: "",
                last_name: "",
                preferred_name: "",
                dob: "",
                email: "",
                phone: "",
                address: addressToFields(null),
                notes: "",
              }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
