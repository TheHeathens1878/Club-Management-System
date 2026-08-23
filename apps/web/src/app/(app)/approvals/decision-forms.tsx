"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/field";

import { approveRequest, rejectRequest, type DecisionState } from "./actions";

/**
 * Approve / reject for one pending request.
 *
 * The `blocked` outcome is not an error to tidy away: the database refused
 * because a safeguarding requirement is not met, the request is still waiting,
 * and the fix is on the person's record. So it is shown in full, with the way
 * there.
 */
export function DecisionPanel({
  requestId,
  personId,
  personName,
}: {
  requestId: string;
  personId: string;
  personName: string;
}) {
  const [approveState, approve, approving] = useActionState<DecisionState, FormData>(
    approveRequest,
    {},
  );
  const [rejectState, reject, rejecting] = useActionState<DecisionState, FormData>(
    rejectRequest,
    {},
  );
  const [showReject, setShowReject] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <form action={approve} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="request_id" value={requestId} />
          <input type="hidden" name="person_id" value={personId} />
          <div className="min-w-56 space-y-1">
            <Label htmlFor={`approve-note-${requestId}`} className="text-xs text-muted-foreground">
              Note (optional)
            </Label>
            <Input id={`approve-note-${requestId}`} name="note" placeholder="Checked with the coach" />
          </div>
          <Button type="submit" size="sm" disabled={approving}>
            <Check className="h-4 w-4" />
            {approving ? "Approving…" : "Approve"}
          </Button>
        </form>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowReject((open) => !open)}
        >
          <X className="h-4 w-4" /> Reject
        </Button>
      </div>

      {showReject ? (
        <form action={reject} className="space-y-2 rounded-lg border p-3">
          <input type="hidden" name="request_id" value={requestId} />
          <Label htmlFor={`reject-note-${requestId}`}>Why? {personName} will see this.</Label>
          <Textarea id={`reject-note-${requestId}`} name="note" rows={2} required />
          <Button type="submit" variant="destructive" size="sm" disabled={rejecting}>
            {rejecting ? "Rejecting…" : "Reject request"}
          </Button>
        </form>
      ) : null}

      {approveState.blocked ? (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" /> Safeguarding refused this approval
          </p>
          <p className="whitespace-pre-wrap text-sm text-destructive">{approveState.blocked.detail}</p>
          <p className="text-xs text-muted-foreground">
            The request is still waiting. Add or renew the certificate on the person&apos;s record,
            then approve again.
          </p>
          <Link
            href={`/people/${approveState.blocked.personId}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open {personName}&apos;s record
          </Link>
        </div>
      ) : null}

      {approveState.error ? (
        <p className="whitespace-pre-wrap text-sm text-destructive">{approveState.error}</p>
      ) : null}
      {approveState.notice ? (
        <p className="text-sm text-muted-foreground">{approveState.notice}</p>
      ) : null}
      {rejectState.error ? (
        <p className="whitespace-pre-wrap text-sm text-destructive">{rejectState.error}</p>
      ) : null}
      {rejectState.notice ? (
        <p className="text-sm text-muted-foreground">{rejectState.notice}</p>
      ) : null}
    </div>
  );
}
