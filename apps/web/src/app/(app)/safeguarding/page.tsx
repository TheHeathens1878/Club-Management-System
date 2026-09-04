import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, FileWarning, ShieldAlert } from "lucide-react";

import type { Database } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin, isSafeguardingLead } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { LeadPanel, type LeadPerson } from "./lead-panel";
import { OversightForm } from "./oversight-form";

export const metadata = { title: "Safeguarding" };

/**
 * The safeguarding desk (PLAN.md P4.3, P5.6).
 *
 * User-scoped client throughout. `read_concerns()` decides for itself whether
 * this caller may see anything — an unauthorised call returns zero rows AND
 * writes an audit row, so an empty list here is a real answer, not a silent
 * failure. The page is additionally gated in the app so that a member who is
 * neither committee nor lead never lands on it at all.
 */

type ConcernStatus = Database["public"]["Enums"]["concern_status"];

const STATUSES: ConcernStatus[] = ["received", "under_review", "closed"];

function severityVariant(severity: string | null): "destructive" | "warning" | "default" | "muted" {
  if (severity === "critical" || severity === "high") return "destructive";
  if (severity === "medium") return "warning";
  if (severity === "low") return "default";
  return "muted";
}

function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export default async function SafeguardingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const lead = await isSafeguardingLead();
  if (!lead && !isCommittee(session.profile?.role)) redirect("/safeguarding/report");

  const { status } = await searchParams;
  const filter = STATUSES.includes(status as ConcernStatus) ? (status as ConcernStatus) : undefined;

  const supabase = await createClient();
  const [{ data: concerns, error: concernsError }, admin, { data: leadRoles }] =
    await Promise.all([
      supabase.rpc("read_concerns", { p_status: filter }),
      isClubAdmin(),
      supabase
        .from("person_roles")
        .select("person_id, people:person_id(id, first_name, last_name, email)")
        .eq("role", "safeguarding_lead")
        .is("revoked_at", null),
    ]);

  const toLeadPerson = (p: { id: string; first_name: string; last_name: string; email: string | null }): LeadPerson => ({
    id: p.id,
    name: `${p.first_name} ${p.last_name}`,
    email: p.email,
  });
  const currentLeads: LeadPerson[] = (leadRoles ?? [])
    .map((r) => r.people)
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map(toLeadPerson);

  // The appoint list only exists for a club_admin (people RLS gives them
  // everyone; a lead who is not an admin would see only a subset anyway).
  let people: LeadPerson[] = [];
  if (admin) {
    const { data } = await supabase
      .from("people")
      .select("id, first_name, last_name, email")
      .is("deleted_at", null)
      .order("last_name")
      .order("first_name");
    people = (data ?? []).map(toLeadPerson);
  }

  return (
    <>
      <PageHeader
        title="Safeguarding"
        subtitle="Concerns and oversight"
        action={
          <Link
            href="/safeguarding/report"
            className={
              buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] gap-2 lg:min-h-0"
            }
          >
            <FileWarning className="h-4 w-4" /> Report a concern
          </Link>
        }
      />

      <div className="space-y-6 p-4 lg:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">Safeguarding lead</CardTitle>
            <p className="text-sm text-muted-foreground">
              The named person who reviews concerns and may open a young person&apos;s
              conversation with a reason. Changing the lead is recorded in the audit log.
            </p>
          </CardHeader>
          <CardContent>
            <LeadPanel current={currentLeads} people={people} canEdit={admin} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4" /> Concerns
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Read through the audited accessor. A concern that names you is never shown to you,
              whatever role you hold.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* The status filters scroll in their own strip on a phone. */}
            <div className="-mx-6 flex gap-2 overflow-x-auto whitespace-nowrap px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
              <Link
                href="/safeguarding"
                className={
                  buttonVariants({ variant: filter ? "outline" : "secondary", size: "sm" }) +
                  " min-h-[44px] flex-none lg:min-h-0"
                }
              >
                All
              </Link>
              {STATUSES.map((s) => (
                <Link
                  key={s}
                  href={`/safeguarding?status=${s}`}
                  className={
                    buttonVariants({ variant: filter === s ? "secondary" : "outline", size: "sm" }) +
                    " min-h-[44px] flex-none lg:min-h-0"
                  }
                >
                  {s.replace("_", " ")}
                </Link>
              ))}
            </div>

            {concernsError && (
              <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {concernsError.message}
              </p>
            )}

            {(concerns ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No concerns to show.</p>
            )}

            {(concerns ?? []).map((concern) => (
              <Link
                key={concern.id}
                href={`/safeguarding/concerns/${encodeURIComponent(concern.ref)}`}
                className="block rounded-lg border bg-card p-4 transition-colors hover:bg-secondary/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{concern.ref}</span>
                    <Badge variant={concern.status === "closed" ? "muted" : "default"}>
                      {concern.status.replace("_", " ")}
                    </Badge>
                    <Badge variant={severityVariant(concern.severity)}>{concern.severity ?? "unrated"}</Badge>
                    {concern.legal_hold && <Badge variant="warning">Legal hold</Badge>}
                  </div>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {formatStamp(concern.created_at)} <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{concern.narrative}</p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">Conversation oversight (SG-9)</CardTitle>
            <p className="text-sm text-muted-foreground">
              A safeguarding lead or club administrator may open or export any conversation a young
              person is, or has been, part of. There is no list of everyone&apos;s private
              conversations — reads are one conversation at a time, with a reason, and every one is
              recorded in the audit log.
            </p>
          </CardHeader>
          <CardContent>
            <OversightForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
