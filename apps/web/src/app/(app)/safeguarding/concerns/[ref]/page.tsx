import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isSafeguardingLead, nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { AddNoteForm, UpdateConcernForm } from "./concern-forms";

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

export default async function ConcernPage({ params }: { params: Promise<{ ref: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const lead = await isSafeguardingLead();
  if (!lead && !isCommittee(session.profile?.role)) redirect("/safeguarding/report");

  const { ref } = await params;
  const concernRef = decodeURIComponent(ref);

  const supabase = await createClient();
  const { data: concerns, error } = await supabase.rpc("read_concerns", { p_ref: concernRef });
  const concern = concerns?.[0];

  // Zero rows is the accessor's answer for "not yours to read", and it has
  // already written the audit row. Nothing more to add here.
  if (!concern) {
    if (error) {
      return (
        <>
          <PageHeader title={concernRef} subtitle="Safeguarding concern" />
          <div className="max-w-2xl p-4 lg:p-6">
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error.message}
            </p>
          </div>
        </>
      );
    }
    notFound();
  }

  // Notes are lead-only; a club_admin reading the case gets the case, not the
  // notes, and the accessor is what says so.
  const { data: notes, error: notesError } = await supabase.rpc("read_concern_notes", { p_ref: concernRef });

  const names = await resolveNames([
    concern.subject_person_id ?? "",
    concern.reported_person_id ?? "",
    concern.reported_by_person_id ?? "",
    ...(notes ?? []).map((n) => n.author_person_id),
  ]);

  return (
    <>
      <PageHeader
        title={concern.ref}
        subtitle="Safeguarding concern"
        back={{ href: "/safeguarding", label: "Safeguarding" }}
      />

      <div className="max-w-3xl space-y-6 p-4 lg:p-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={concern.status === "closed" ? "muted" : "default"}>
                {concern.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline">{concern.severity ?? "unrated"}</Badge>
              {concern.legal_hold && <Badge variant="warning">Legal hold</Badge>}
              <span className="text-xs text-muted-foreground">
                Reported {formatStamp(concern.created_at)} via {concern.channel}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap">{concern.narrative}</p>
            <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <div>
                <dt className="font-medium text-foreground">Reported by</dt>
                <dd>{concern.reported_by_person_id ? nameOf(names, concern.reported_by_person_id) : "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">About (subject)</dt>
                <dd>{concern.subject_person_id ? nameOf(names, concern.subject_person_id) : "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Person of concern</dt>
                <dd>{concern.reported_person_id ? nameOf(names, concern.reported_person_id) : "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {lead && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Case management</CardTitle>
            </CardHeader>
            <CardContent>
              <UpdateConcernForm
                concernRef={concern.ref}
                status={concern.status}
                severity={concern.severity}
                legalHold={concern.legal_hold}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Case notes</CardTitle>
            <p className="text-sm text-muted-foreground">
              Visible to the safeguarding lead. The original account above is immutable; everything
              since is a note.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {notesError && (
              <p className="rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {notesError.message}
              </p>
            )}
            {!notesError && (notes ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            )}
            {(notes ?? []).map((note) => (
              <div key={note.id} className="rounded-lg border p-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  {nameOf(names, note.author_person_id)} · {formatStamp(note.created_at)}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
              </div>
            ))}
            {lead && <AddNoteForm concernRef={concern.ref} />}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
