"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";

import { appointSafeguardingLead, type LeadActionState } from "./lead-actions";

export type LeadPerson = { id: string; name: string; email: string | null };

export function LeadPanel({
  current,
  people,
  canEdit,
}: {
  current: LeadPerson[];
  people: LeadPerson[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<LeadActionState, FormData>(appointSafeguardingLead, {});

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase text-muted-foreground">Current lead</p>
        {current.length === 0 ? (
          <p className="text-sm text-destructive">
            Nobody holds the role. Until someone does, no certification exemptions can be granted and
            concerns have no reviewer.
          </p>
        ) : (
          <ul className="text-sm">
            {current.map((p) => (
              <li key={p.id}>
                <span className="font-medium">{p.name}</span>
                {p.email ? <span className="text-muted-foreground"> · {p.email}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canEdit ? (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 space-y-1">
            <Label htmlFor="lead-person">Appoint</Label>
            <select
              id="lead-person"
              name="person_id"
              required
              defaultValue=""
              className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Choose a person…
              </option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.email ? ` — ${p.email}` : ""}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Make safeguarding lead"}
          </Button>
          {state.error ? <p className="w-full text-sm text-destructive">{state.error}</p> : null}
          {state.notice ? <p className="w-full text-sm text-muted-foreground">{state.notice}</p> : null}
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Only a club administrator can change the lead.</p>
      )}
    </div>
  );
}
