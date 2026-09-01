"use client";

import { useActionState } from "react";
import { LogOut } from "lucide-react";

import { leaveConversation, type ActionState } from "../actions";

const EMPTY: ActionState = {};

/**
 * Leaving is an SG-1 operation: the database evaluates the conversation
 * *after* the departure and refuses if it would leave one adult alone with one
 * child. Its refusal is shown word for word — it names the rule.
 */
export function LeaveButton({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(leaveConversation, EMPTY);

  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="conversation_id" value={conversationId} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-60 lg:min-h-0 lg:py-1.5"
        >
          <LogOut className="h-3.5 w-3.5" /> Leave conversation
        </button>
      </form>
      {state.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
    </div>
  );
}
