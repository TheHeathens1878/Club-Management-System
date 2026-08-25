import Link from "next/link";
import { redirect } from "next/navigation";
import { Contact, UsersRound } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { AddAdultForm } from "./household-forms";

/**
 * Connected Adults (Adam's parent menu, 2026-08-25) — the adults in the
 * caller's household who have no login of their own: a spouse added on the
 * /join wizard, or here.
 *
 * The list is `my_household()` (20260824470000), which returns exactly the
 * people `add_household_adult()` created for this login and nobody else — no
 * children (My Children is their page), never another account's people. An
 * adult who holds their own login is deliberately absent too: they are their
 * own person in the club's eyes, not an entry in someone else's household.
 */

export const dynamic = "force-dynamic";

export default async function ConnectedAdultsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_household");
  const adults = data ?? [];

  return (
    <>
      <PageHeader
        title="Connected adults"
        subtitle="Adults in your household the club knows through your account"
      />

      <div className="space-y-6 p-6">
        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRound className="h-4 w-4" /> Connect an adult
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              For an adult in your household who will not have their own login — a spouse or
              partner, say. You can then register them for the club from your own account. An
              adult who wants their own login simply{" "}
              <Link href="/register" className="underline">
                creates their own account
              </Link>{" "}
              instead.
            </p>
          </CardHeader>
          <CardContent>
            <AddAdultForm />
          </CardContent>
        </Card>

        {adults.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No adults are connected to your account yet.
            </CardContent>
          </Card>
        ) : (
          adults.map((adult) => (
            <Card key={adult.person_id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Contact className="h-4 w-4" />
                  {adult.first_name} {adult.last_name}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Corrections to their record go through the club — ask a club administrator.
                  Their registrations appear on{" "}
                  <Link href="/my-registrations" className="underline">
                    Registrations
                  </Link>
                  .
                </p>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Email</dt>
                    <dd className="mt-0.5">{adult.email ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Phone</dt>
                    <dd className="mt-0.5">{adult.phone ?? "Not recorded"}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
