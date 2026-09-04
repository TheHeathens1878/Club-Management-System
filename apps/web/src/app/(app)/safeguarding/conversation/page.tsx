import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Download, Eye } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isSafeguardingLead } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Conversation (oversight)" };

/**
 * SG-9 oversight read.
 *
 * `read_conversation_as_lead()` checks the caller's role, insists on a
 * non-blank reason, refuses conversations that have never involved a minor,
 * and writes the audit row before it returns anything — so this page does not
 * re-implement any of that, it just calls it and shows what comes back. Its
 * refusals are shown verbatim.
 *
 * Reading here creates no participant row (SG-1.5), which is exactly why this
 * screen exists instead of "add yourself to the conversation".
 */
export default async function LeadConversationPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; reason?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const lead = await isSafeguardingLead();
  if (!lead && !isCommittee(session.profile?.role)) redirect("/safeguarding/report");

  const { id, reason } = await searchParams;
  if (!id || !reason) redirect("/safeguarding");

  const supabase = await createClient();
  const { data: messages, error } = await supabase.rpc("read_conversation_as_lead", {
    p_conversation_id: id,
    p_reason: reason,
  });

  const exportHref = `/safeguarding/conversation/export?id=${encodeURIComponent(id)}&reason=${encodeURIComponent(reason)}`;

  return (
    <>
      <PageHeader
        title="Conversation (oversight)"
        subtitle="Read under SG-9 — this access has been recorded"
        action={
          <Link
            href="/safeguarding"
            className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:underline lg:min-h-0"
          >
            <ChevronLeft className="h-4 w-4" /> Safeguarding
          </Link>
        }
      />

      {/* A readable measure on a phone: 16px gutters, and the conversation id
          wraps inside the banner rather than pushing the page sideways. */}
      <div className="max-w-3xl space-y-4 p-4 lg:p-6">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">This read is logged against your name.</p>
            <p className="mt-0.5 break-words">
              Conversation <span className="font-mono">{id}</span> · reason: {reason}
            </p>
          </div>
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error.message}
          </p>
        ) : (
          <>
            <div className="flex justify-end">
              <a
                href={exportHref}
                className={
                  buttonVariants({ variant: "outline", size: "sm" }) +
                  " min-h-[44px] w-full gap-2 sm:w-auto lg:min-h-0"
                }
              >
                <Download className="h-4 w-4" /> Export as JSON
              </a>
            </div>

            {(messages ?? []).length === 0 && (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  This conversation has no messages. The access has still been recorded.
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              {(messages ?? []).map((message) => (
                <div key={message.id} className="rounded-lg border bg-card p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{message.sender_name ?? "Unknown"}</span>
                    <span>
                      {new Date(message.created_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}
                    </span>
                    {message.deleted_at && <Badge variant="muted">deleted by sender</Badge>}
                    {message.redacted_at && <Badge variant="warning">redacted</Badge>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words">{message.body}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
