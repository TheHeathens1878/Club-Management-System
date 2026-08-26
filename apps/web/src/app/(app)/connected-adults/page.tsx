import Link from "next/link";
import { redirect } from "next/navigation";
import { Contact, UsersRound } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { AddAdultForm } from "./household-forms";
import { EditAdultForm } from "./edit-adult-form";

/**
 * Connected Adults (Adam's parent menu, 2026-08-25) — the adults the club
 * connects to this account.
 *
 * The connection is the FAMILY MEMBERSHIP, not the absence of a login (Adam:
 * "a connected adult may come under a family membership which will be at lead
 * contact level. They will have their own login but membership paid by another
 * adult."). `my_household()` (20260824490000) therefore returns three shapes,
 * each scoped to the caller: the login-less adults this account created, the
 * adults on a membership the caller holds as lead contact — their own login or
 * not — and, from the other side, the lead contact whose membership covers the
 * caller. Children are deliberately absent; My Children is their page.
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
        subtitle="The adults the club connects to your account — your household, and your family membership"
        action={
          <Link
            href="/my-registrations"
            className={buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] lg:min-h-0"}
          >
            Register a player
          </Link>
        }
      />

      <div className="space-y-6 p-4 lg:p-6">
        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
          </p>
        )}

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRound className="h-4 w-4" /> Connect an adult
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Any adult the club should treat as part of your household — a partner, a grown-up son
              or daughter, or whoever else shares the membership. They do not have to play, and
              they do not have to be new to the club: connecting somebody who already has their own
              login is how one membership and one bill covers you both.
            </p>
            <p className="text-sm text-muted-foreground">
              Give their email address and the club connects the record it already holds rather
              than creating a second one. If they have no login yet, one can be created later and
              they stay connected — the membership keeps the tie either way.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
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
              <CardHeader className="p-4 lg:p-6">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <Contact className="h-4 w-4" />
                  {adult.first_name} {adult.last_name}
                  {adult.my_lead ? (
                    <Badge variant="default">Lead contact</Badge>
                  ) : adult.has_login ? (
                    <Badge variant="success">Has their own login</Badge>
                  ) : (
                    <Badge variant="muted">No login yet</Badge>
                  )}
                  {adult.on_my_membership && <Badge variant="outline">On your membership</Badge>}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {adult.my_lead ? (
                    <>Their family membership covers you — they are the lead contact who pays.</>
                  ) : adult.has_login ? (
                    <>
                      They manage their own account and registrations; their membership sits under
                      yours, with you as the lead contact.
                    </>
                  ) : (
                    <>
                      They have no login of their own, so their record is yours to keep right.
                      Their registrations appear on{" "}
                      <Link href="/my-registrations" className="underline">
                        Register a player
                      </Link>
                      .
                    </>
                  )}
                </p>
              </CardHeader>
              <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Email</dt>
                    <dd className="mt-0.5">{adult.email ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Phone</dt>
                    <dd className="mt-0.5">{adult.phone ?? "Not recorded"}</dd>
                  </div>
                </dl>

                {/* Adam, 2026-08-26: "We should be able to edit details also."
                    Only for somebody with no login — a person who holds an
                    account keeps their own details, and their email address is
                    where a password reset goes. The database refuses it again
                    on the way in. */}
                {!adult.has_login && (
                  <div className="mt-4">
                    <EditAdultForm
                      personId={adult.person_id}
                      firstName={adult.first_name}
                      lastName={adult.last_name}
                      preferredName={adult.preferred_name ?? null}
                      email={adult.email ?? null}
                      phone={adult.phone ?? null}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
