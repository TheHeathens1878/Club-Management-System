"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { withdrawAccountRequest, type RequestState } from "./actions";

export function WithdrawForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState<RequestState, FormData>(
    withdrawAccountRequest,
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="request_id" value={requestId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Withdrawing…" : "Withdraw"}
      </Button>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
      {state.notice ? <span className="text-xs text-muted-foreground">{state.notice}</span> : null}
    </form>
  );
}
