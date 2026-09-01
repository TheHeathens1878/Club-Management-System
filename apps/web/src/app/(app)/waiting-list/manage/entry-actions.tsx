"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/field";
import {
  STATUS_LABELS,
  WAITING_LIST_STATUSES,
  type WaitingListStatus,
} from "@/lib/waiting-list";

import {
  addWaitingListNote,
  setWaitingListStatus,
  type WaitingListActionState,
} from "./actions";

export function NoteForm({ entryId }: { entryId: string }) {
  const [state, action, pending] = useActionState<WaitingListActionState, FormData>(
    addWaitingListNote,
    {},
  );

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="entry_id" value={entryId} />
      <Textarea
        name="body"
        rows={2}
        required
        placeholder="Add a note — a call made, a trial offered, anything the next person needs to know."
        aria-label="New note"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={pending}
          className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
        >
          {pending ? "Saving…" : "Add note"}
        </Button>
        {state.error && <span className="text-sm text-destructive">{state.error}</span>}
        {state.notice && <span className="text-sm text-muted-foreground">{state.notice}</span>}
      </div>
    </form>
  );
}

export function StatusForm({
  entryId,
  status,
}: {
  entryId: string;
  status: WaitingListStatus;
}) {
  const [state, action, pending] = useActionState<WaitingListActionState, FormData>(
    setWaitingListStatus,
    {},
  );

  return (
    <form
      action={action}
      className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-center"
    >
      <input type="hidden" name="entry_id" value={entryId} />
      <Select
        name="status"
        defaultValue={status}
        aria-label="Status"
        className="min-h-[44px] lg:h-9 lg:w-auto lg:min-h-0 lg:min-w-40"
      >
        {WAITING_LIST_STATUSES.map((value) => (
          <option key={value} value={value}>
            {STATUS_LABELS[value]}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" disabled={pending} className="min-h-[44px] lg:min-h-0">
        {pending ? "Saving…" : "Update status"}
      </Button>
      {state.error && <span className="text-sm text-destructive">{state.error}</span>}
      {state.notice && <span className="text-sm text-muted-foreground">{state.notice}</span>}
    </form>
  );
}
