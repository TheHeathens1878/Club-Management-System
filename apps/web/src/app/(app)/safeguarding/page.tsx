import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ChevronRight, FileWarning, ShieldAlert } from "lucide-react";

import type { Database } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isSafeguardingLead } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { OversightForm } from "./oversight-form";

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

function complianceVariant(status: string): "success" | "warning" | "destructive" | "muted" {
  if (status === "valid") return "success";
  if (status === "expiring") return "warning";
  if (status === "expired") return "destructive";
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
  const [{ data: concerns, error: concernsError }, { data: compliance }] = await Promise.all([
    supabase.rpc("read_concerns", { p_status: filter }),
    supabase.rpc("compliance_report"),
  ]);

  return (
    <>
      <PageHeader
        title="Safeguarding"
        subtitle="Concerns, oversight and compliance"
        action={
          <Link href="/safeguarding/report" className={buttonVariants({ variant: "outline", size: "sm" }) + " gap-2"}>
            <FileWarning className="h-4 w-4" /> Report a concern
          </Link>
        }
      />

      <div className="p-6 space-y-6 max-w-5xl">
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
            <div className="flex flex-wrap gap-2">
              <Link
                href="/safeguarding"
                className={buttonVariants({ variant: filter ? "outline" : "secondary", size: "sm" })}
              >
                All
              </Link>
              {STATUSES.map((s) => (
                <Link
                  key={s}
                  href={`/safeguarding?status=${s}`}
                  className={buttonVariants({ variant: filter === s ? "secondary" : "outline", size: "sm" })}
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" /> Compliance (SG-6)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              People in child-facing roles on teams with young players whose DBS or safeguarding
              certification is not current.
            </p>
          </CardHeader>
          <CardContent>
            {(compliance ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Everyone in a child-facing role is compliant.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Person</th>
                      <th className="py-2 pr-3 font-medium">Team</th>
                      <th className="py-2 pr-3 font-medium">Role</th>
                      <th className="py-2 pr-3 font-medium">DBS</th>
                      <th className="py-2 pr-3 font-medium">Safeguarding</th>
                      <th className="py-2 font-medium">Exemption</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(compliance ?? []).map((row) => (
                      <tr key={`${row.team_id}-${row.person_id}`} className="border-b last:border-0">
                        <td className="py-2 pr-3">{row.person_name}</td>
                        <td className="py-2 pr-3">
                          <Link href={`/teams/${row.team_id}`} className="hover:underline">
                            {row.team_name}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{row.role}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={complianceVariant(row.dbs_status)}>{row.dbs_status}</Badge>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant={complianceVariant(row.safeguarding_status)}>
                            {row.safeguarding_status}
                          </Badge>
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {row.exemption_expires_on ? `until ${row.exemption_expires_on}` : "none"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
