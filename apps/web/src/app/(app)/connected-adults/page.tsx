import Link from "next/link";
import { redirect } from "next/navigation";
import { Contact, UsersRound } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { AddAdultForm } from "./household-forms";

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
              For an adult in your household who does not have their own login yet — a spouse or
              partner, say. You can then register them for the club from your own account, and if
              your membership is a family one it covers them at your lead-contact level. If they
              later{" "}
              <Link href="/register" className="underline">
                create their own login
              </Link>
              , they stay connected here — the membership keeps the tie.
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
                      Corrections to their record go through the club — ask a club administrator.
                      Their registrations appear on{" "}
                      <Link href="/my-registrations" className="underline">
                        Registrations
                      </Link>
                      .
                    </>
                  )}
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
