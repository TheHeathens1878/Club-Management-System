"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

import { decideLeaveRequest, type DecisionState } from "./actions";

/**
 * Approve / reject one "this player has left" (Adam, 2026-08-25).
 *
 * Approving ENDS THE MEMBERSHIP, so it is spelt out rather than left to a verb:
 * this is the same act as pressing End on the Squad tab, which is why only a
 * club administrator can do either. The note is optional on both sides and the
 * coach who asked is told the answer either way.
 *
 * `blocked` is SG-6 refusing to let the membership end. It is shown in full
 * with the way to the person's record, exactly as `DecisionPanel` does — the
 * request stays waiting until the paperwork is right.
 */
export function LeaveDecisionForms({
  requestId,
  personId,
  personName,
}: {
  requestId: string;
  personId: string;
  personName: string;
}) {
  const [state, decide, deciding] = useActionState<DecisionState, FormData>(
    decideLeaveRequest,
    {},
  );

  return (
    <div className="space-y-3">
      <form
        action={decide}
        className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-end"
      >
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="person_id" value={personId} />
        <div className="space-y-1 lg:min-w-56">
          <Label htmlFor={`leave-note-${requestId}`} className="text-xs text-muted-foreground">
            Note (optional)
          </Label>
          <Input
            id={`leave-note-${requestId}`}
            name="note"
            placeholder="Spoke to the family"
          />
        </div>
        <Button
          type="submit"
          name="approve"
          value="yes"
          size="sm"
          disabled={deciding}
          className="min-h-[44px] lg:min-h-0"
        >
          <Check className="mr-1 h-4 w-4" />
          Remove {personName.split(" ")[0]} from the squad
        </Button>
        <Button
          type="submit"
          name="approve"
          value="no"
          size="sm"
          variant="outline"
          disabled={deciding}
          className="min-h-[44px] lg:min-h-0"
        >
          <X className="mr-1 h-4 w-4" />
          Keep them
        </Button>
      </form>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.notice ? <p className="text-sm text-emerald-700">{state.notice}</p> : null}
      {state.blocked ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="whitespace-pre-wrap">{state.blocked.detail}</span>
          </p>
          <Link
            href={`/people/${state.blocked.personId}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open {personName}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
