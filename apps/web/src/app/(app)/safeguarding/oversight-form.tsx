"use client";

import { useActionState } from "react";
import { Eye } from "lucide-react";

import { Textarea } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";

import { openConversationAsLead, type ActionState } from "./actions";

const EMPTY: ActionState = {};

/**
 * SG-9: there is no "list every private conversation" screen, and there is no
 * policy that would let one exist — reading is only ever through the audited
 * accessor, for a named conversation, with a stated reason.
 */
export function OversightForm() {
  const [state, action, pending] = useActionState(openConversationAsLead, EMPTY);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="oversight-id">Conversation id</Label>
        <Input
          id="oversight-id"
          name="conversation_id"
          placeholder="00000000-0000-0000-0000-000000000000"
          required
          className="h-11 lg:h-10"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="oversight-reason">Reason *</Label>
        <Textarea
          id="oversight-reason"
          name="reason"
          rows={2}
          required
          placeholder="Why this conversation needs to be read. Recorded against your name."
        />
      </div>
      {state.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 sm:w-auto lg:min-h-0 lg:py-2"
      >
        <Eye className="h-4 w-4" /> Open conversation
      </button>
    </form>
  );
}
