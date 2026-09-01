"use client";

import { useActionState } from "react";

import { Textarea } from "@/components/ui/field";
import { Label } from "@/components/ui/input";

import { addConcernNote, updateConcern, type ActionState } from "../../actions";

const EMPTY: ActionState = {};

/** 44px on a phone, the desk's 40px from lg up. */
const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm lg:h-10";

/** safeguarding_lead only. The accessor refuses anyone else and records it. */
export function UpdateConcernForm({
  concernRef,
  status,
  severity,
  legalHold,
}: {
  concernRef: string;
  status: string;
  severity: string | null;
  legalHold: boolean;
}) {
  const [state, action, pending] = useActionState(updateConcern, EMPTY);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="ref" value={concernRef} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <select id="status" name="status" defaultValue={status} className={selectClass}>
            <option value="received">received</option>
            <option value="under_review">under review</option>
            <option value="closed">closed</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="severity">Severity</Label>
          <select id="severity" name="severity" defaultValue={severity ?? ""} className={selectClass}>
            <option value="">unrated</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="legal_hold">Legal hold</Label>
          <select id="legal_hold" name="legal_hold" defaultValue={String(legalHold)} className={selectClass}>
            <option value="false">off</option>
            <option value="true">on</option>
          </select>
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.notice}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 sm:w-auto lg:min-h-0 lg:py-2"
      >
        Save
      </button>
    </form>
  );
}

export function AddNoteForm({ concernRef }: { concernRef: string }) {
  const [state, action, pending] = useActionState(addConcernNote, EMPTY);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="ref" value={concernRef} />
      <Textarea name="body" rows={3} required placeholder="Add a case note" />
      {state.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-secondary disabled:opacity-60 sm:w-auto lg:min-h-0 lg:py-1.5"
      >
        Add note
      </button>
    </form>
  );
}
