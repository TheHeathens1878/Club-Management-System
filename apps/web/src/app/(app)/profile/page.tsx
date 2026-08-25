import { redirect } from "next/navigation";
import { UserCircle } from "lucide-react";

import type { Json } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCurrentPersonId } from "@/lib/person";
import { personLabel } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

import { loadEmergencyContacts } from "@/lib/emergency-contacts-server";

import { ContactDetailsForm, OwnEmergencyContactsForm, type ContactDetails } from "./profile-form";

/**
 * My Profile (Adam's parent menu, 2026-08-25) — the caller's own record.
 *
 * One row, read under `people_self_read`, so an unlinked sign-in gets an empty
 * answer and an explanation rather than someone else's data. The editable
 * fields are exactly the ones `update_own_contact()` accepts (preferred name,
 * phone, address); name, email and date of birth are printed read-only with
 * the reason — the club corrects the record, and the email is the login.
 */

export const dynamic = "force-dynamic";

function addressField(address: Json | null, key: string): string {
  if (!address || typeof address !== "object" || Array.isArray(address)) return "";
  const value = (address as Record<string, Json | undefined>)[key];
  return typeof value === "string" ? value : "";
}

function formatDob(dob: string | null): string {
  if (!dob) return "Not recorded";
  const parsed = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default async function ProfilePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const personId = await getCurrentPersonId();
  const supabase = await createClient();

  const { data: person, error } = personId
    ? await supabase
        .from("people")
        .select("first_name,last_name,preferred_name,email,phone,dob,address")
        .eq("id", personId)
        .maybeSingle()
    : { data: null, error: null };

  // Emergency contacts (Adam, 2026-08-25): the person's own, up to two.
  const emergencyContacts = personId
    ? ((await loadEmergencyContacts([personId])).get(personId) ?? [])
    : [];

  const initial: ContactDetails | null = person
    ? {
        preferredName: person.preferred_name ?? "",
        phone: person.phone ?? "",
        line1: addressField(person.address, "line1"),
        line2: addressField(person.address, "line2"),
        town: addressField(person.address, "town"),
        postcode: addressField(person.address, "postcode"),
      }
    : null;

  return (
    <>
      <PageHeader title="My profile" subtitle="What the club holds about you, and the parts you can change yourself" />

      <div className="space-y-6 p-4 lg:p-6">
        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
          </p>
        )}

        {!person ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Your sign-in is not linked to a member record yet, so there is nothing to show here.
              Ask the club to link your account.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="p-4 lg:p-6">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserCircle className="h-4 w-4" /> {personLabel(person)}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Your name and date of birth are corrected by the club, not here — ask a club
                  administrator and they will change the record. Your email address is your login.
                </p>
              </CardHeader>
              <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
                <dl className="grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Name</dt>
                    <dd className="mt-0.5">
                      {person.first_name} {person.last_name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Email</dt>
                    <dd className="mt-0.5">{person.email ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Date of birth</dt>
                    <dd className="mt-0.5">{formatDob(person.dob)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 lg:p-6">
                <CardTitle className="text-base">Contact details</CardTitle>
                <p className="text-sm text-muted-foreground">
                  These are yours to keep current — the club uses them to reach you.
                </p>
              </CardHeader>
              <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
                {initial && <ContactDetailsForm initial={initial} />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 lg:p-6">
                <CardTitle className="text-base">Emergency contacts</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Up to two people the club can ring about you. Kept on your record, so they are
                  asked for once rather than on every registration form.
                </p>
              </CardHeader>
              <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
                <OwnEmergencyContactsForm
                  initial={emergencyContacts}
                  personName={person.preferred_name || person.first_name}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
