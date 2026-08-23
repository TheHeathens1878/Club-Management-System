"use client";

import { useActionState } from "react";
import { CreditCard, Loader2 } from "lucide-react";

import { startCheckout, type ActionState } from "./actions";

const EMPTY: ActionState = {};

export function PayNowButton({ subscriptionId }: { subscriptionId: string }) {
  const [state, action, pending] = useActionState(startCheckout, EMPTY);

  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="subscription_id" value={subscriptionId} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          Pay now
        </button>
      </form>
      {state.error && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {state.error}
        </p>
      )}
    </div>
  );
}
