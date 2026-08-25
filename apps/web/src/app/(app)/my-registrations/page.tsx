import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { formatStamp } from "@/lib/people-display";
import {
  REGISTRATION_STATUS_LABELS,
  registrationStatusVariant,
  type RegistrationStatusValue,
} from "@/lib/registration-form";
import { createClient } from "@/lib/supabase/server";

import { WithdrawForm } from "../family/family-forms";

/**
 * Registrations (Adam's parent menu, 2026-08-25) — the household's
 * registration statuses in one list: the caller's own, their guarded
 * children's, and their connected adults'.
 *
 * `my_registrations()` (20260824470000) is the read, and it deliberately does
 * NOT return the form — the medical answers are not a status list's business.
 * This page is not the admin queue: that stays at /registrations under
 * `registrations_admin_read`.
 *
 * Withdraw is offered only where the database would allow it — the subject or
 * an active guardian (`registrations_guard()`); a connected adult's
 * registration is read-only here, because the guard refuses a withdrawal from
 * someone who is neither the subject nor a guardian. New registrations start
 * from My Children (for a child) — the forms live beside the people they are
 * about.
 */

export const dynamic = "force-dynamic";

export default async function MyRegistrationsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const [registrationsResult, childrenResult] = await Promise.all([
    supabase.rpc("my_registrations"),
    supabase.rpc("my_children"),
  ]);

  const registrations = registrationsResult.data ?? [];
  const childIds = new Set((childrenResult.data ?? []).map((child) => child.person_id));

  // One card per person, in the order the function returns them (newest
  // first), with the caller's own card labelled.
  const byPerson = new Map<string, { name: string; isSelf: boolean; rows: typeof registrations }>();
  for (const row of registrations) {
    const entry = byPerson.get(row.person_id);
    if (entry) entry.rows.push(row);
    else byPerson.set(row.person_id, { name: row.person_name, isSelf: row.is_self, rows: [row] });
  }

  return (
    <>
      <PageHeader
        title="Registrations"
        subtitle="Where every registration in your household stands"
      />

      <div className="space-y-6 p-4 lg:p-6">
        {registrationsResult.error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {registrationsResult.error.message}
          </p>
        )}

        {byPerson.size === 0 ? (
          <Card>
            <CardContent className="space-y-2 py-8 text-center text-sm text-muted-foreground">
              <p>No registrations yet.</p>
              <p>
                Register a child from{" "}
                <Link href="/family" className="underline">
                  My Children
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        ) : (
          Array.from(byPerson.entries()).map(([personId, entry]) => (
            <Card key={personId}>
              <CardHeader className="p-4 lg:p-6">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <ClipboardCheck className="h-4 w-4" />
                  {entry.name}
                  {entry.isSelf && <Badge variant="outline">You</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
                <ul className="space-y-2">
                  {entry.rows.map((row) => {
                    const status = row.status as RegistrationStatusValue;
                    const canWithdraw =
                      (entry.isSelf || childIds.has(personId)) &&
                      (status === "pending" || status === "approved");
                    return (
                      <li
                        key={row.registration_id}
                        className="rounded-md border bg-card px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-full font-medium lg:w-auto">
                            {row.team_name ?? "No team requested"}
                          </span>
                          <Badge variant="outline">{row.season_name}</Badge>
                          <Badge variant={registrationStatusVariant(status)}>
                            {REGISTRATION_STATUS_LABELS[status]}
                          </Badge>
                          <span className="w-full text-xs text-muted-foreground lg:ml-auto lg:w-auto">
                            Sent {formatStamp(row.submitted_at)}
                          </span>
                        </div>
                        {canWithdraw && (
                          <div className="mt-2">
                            <WithdrawForm registrationId={row.registration_id} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))
        )}

        <p className="text-sm text-muted-foreground">
          A new registration for a child starts from{" "}
          <Link href="/family" className="underline">
            My Children
          </Link>
          , next to their record.
        </p>
      </div>
    </>
  );
}
