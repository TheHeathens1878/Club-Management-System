import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, UserPlus } from "lucide-react";

import type { Database } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABELS, formatStamp, roleLabel, statusVariant } from "@/lib/account-requests";
import { getCurrentPersonId } from "@/lib/person";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { ROLE_VIEW_HOME, qualifiedViews, resolveRoleView } from "@/lib/role-view";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

import { RoleTiles } from "./role-tiles";
import { WithdrawForm } from "./withdraw-form";

/**
 * "Which hat are you wearing?" — the login tiles, and the page the nav's "My
 * role" link comes back to.
 *
 * Only views the person actually HOLDS are drawn. There is nothing to ask for
 * here any more: a player or a parent is attached to a team through the club's
 * public registration forms, and an account the club has not linked to a
 * member record yet is told so plainly rather than being offered a queue.
 *
 * Requests made before that changed are still listed, read-only, so somebody
 * who already asked can see where it got to and take it back if they want.
 * `/approvals` still decides them.
 *
 * User-scoped client throughout; `account_requests_self_read` is what returns
 * the rows below, and it returns nobody else's.
 */

export const dynamic = "force-dynamic";

type RequestRow = Pick<
  Database["public"]["Tables"]["account_requests"]["Row"],
  | "id"
  | "requested_role"
  | "team_id"
  | "message"
  | "status"
  | "decision_note"
  | "created_at"
  | "decided_at"
>;

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string }>;
}) {
  const { first } = await searchParams;
  const supabase = await createClient();
  const [capabilities, storedView, personId] = await Promise.all([
    getCapabilities(),
    getStoredRoleView(),
    getCurrentPersonId(),
  ]);

  const qualified = qualifiedViews(capabilities);
  const only = qualified.length === 1 ? qualified[0] : undefined;

  // First login with exactly one hat: there is no choice to make, so do not
  // put a one-tile screen in the way. The layout resolves the same view from
  // the capabilities every time, cookie or no cookie.
  if (first && only && !storedView) redirect(ROLE_VIEW_HOME[only]);

  let requests: RequestRow[] = [];
  if (personId) {
    const { data } = await supabase
      .from("account_requests")
      .select("id,requested_role,team_id,message,status,decision_note,created_at,decided_at")
      .eq("person_id", personId)
      .order("created_at", { ascending: false });
    requests = data ?? [];
  }

  const teamIds = Array.from(
    new Set(requests.map((request) => request.team_id).filter((id): id is string => Boolean(id))),
  );
  const teamNames = new Map<string, string>();
  if (teamIds.length > 0) {
    const { data } = await supabase.from("teams").select("id,name").in("id", teamIds);
    for (const row of data ?? []) teamNames.set(row.id, row.name);
  }

  const settings = await getSettings();
  const contactEmail = settings.contact_email;

  return (
    <div>
      <PageHeader
        title={qualified.length > 0 ? "Your role at the club" : "Welcome"}
        subtitle={
          qualified.length > 0
            ? "Pick the one you want to look at. Each shows only that role's screens."
            : "Getting your account joined up with the club's records"
        }
      />

      <div className="space-y-6 p-8">
        {qualified.length > 0 ? (
          <RoleTiles views={qualified} current={resolveRoleView(storedView, capabilities)} />
        ) : (
          <UnlinkedPanel contactEmail={contactEmail} />
        )}

        {requests.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Requests you have already sent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                These were sent before the club moved joining to the registration forms. A club
                administrator still decides them; you can take back one that is still waiting.
              </p>
              <ul className="space-y-3">
                {requests.map((request) => (
                  <li key={request.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {roleLabel(request.requested_role)}
                          {request.team_id ? (
                            <span className="text-muted-foreground">
                              {" · "}
                              {teamNames.get(request.team_id) ?? "Team"}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Asked {formatStamp(request.created_at)}
                          {request.decided_at ? ` · decided ${formatStamp(request.decided_at)}` : ""}
                        </p>
                      </div>
                      <Badge variant={statusVariant(request.status)}>
                        {STATUS_LABELS[request.status]}
                      </Badge>
                    </div>

                    {request.message ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        &ldquo;{request.message}&rdquo;
                      </p>
                    ) : null}

                    {request.decision_note ? (
                      <p
                        className={
                          "mt-2 whitespace-pre-wrap rounded-md p-3 text-sm " +
                          (request.status === "pending"
                            ? "bg-amber-50 text-amber-800"
                            : "bg-muted text-muted-foreground")
                        }
                      >
                        {request.status === "pending" ? (
                          <span className="font-medium">On hold: </span>
                        ) : null}
                        {request.decision_note}
                      </p>
                    ) : null}

                    {request.status === "pending" ? (
                      <div className="mt-3">
                        <WithdrawForm requestId={request.id} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Something not right?{" "}
          <Link href="/safeguarding/report" className="underline">
            Report a safeguarding concern
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

/**
 * The signed-in account the club has not linked to anything yet.
 *
 * No tiles, and nothing to ask for: joining a team is what the registration
 * form is for, and the waiting list is what happens when a team is full. Both
 * are public pages, so the links work whether or not this account is ever
 * linked.
 */
function UnlinkedPanel({ contactEmail }: { contactEmail: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Your account isn&apos;t linked to a club record yet
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          You are signed in, but the club has not yet connected this sign-in to a player, a parent,
          a coach or a member of staff. Until it does there is nothing here to show you — the app
          only ever shows what your own record says you are.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/register"
            className="flex items-start gap-3 rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:bg-secondary"
          >
            <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-sm font-semibold">Register with the club</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                The form the club uses to add a player, and to record a parent or guardian
                alongside them.
              </span>
            </span>
          </Link>
          <Link
            href="/waiting-list"
            className="flex items-start gap-3 rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:bg-secondary"
          >
            <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-sm font-semibold">Join the waiting list</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                For an age group whose squad is full. The club gets in touch when a place comes up.
              </span>
            </span>
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Already registered, or think this is wrong? Contact the club
          {contactEmail ? (
            <>
              {" at "}
              <a href={`mailto:${contactEmail}`} className="underline">
                {contactEmail}
              </a>
            </>
          ) : null}{" "}
          and they will join your sign-in up to your record.
        </p>
      </CardContent>
    </Card>
  );
}
