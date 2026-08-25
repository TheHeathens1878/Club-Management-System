"use client";

/**
 * Grant and revoke waiting list access (gap 10).
 *
 * The person picker searches `people` through the caller's own client, so it
 * can only offer people a club administrator may already read.
 */

import { useActionState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { PersonPicker } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";

import {
  grantWaitingListAccess,
  revokeWaitingListAccess,
  type AccessActionState,
} from "./actions";

export function GrantForm({ ageGroups }: { ageGroups: string[] }) {
  const [state, action, pending] = useActionState<AccessActionState, FormData>(
    grantWaitingListAccess,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      <PersonPicker
        id="wl-access-person"
        name="person_id"
        label="Coach or volunteer"
        placeholder="Search by name or email…"
        required
      />

      <div className="space-y-1.5">
        <Label htmlFor="wl-access-age-group">Age group</Label>
        <Select
          id="wl-access-age-group"
          name="age_group"
          defaultValue=""
          required
          className="min-h-[44px] lg:min-h-0"
        >
          <option value="">Choose an age group</option>
          {ageGroups.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </Select>
        {ageGroups.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No age groups exist yet. Add one on the waiting list desk first.
          </p>
        )}
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

      <Button
        type="submit"
        size="sm"
        disabled={pending}
        className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
      >
        <Plus className="h-4 w-4" />
        {pending ? "Granting…" : "Grant access"}
      </Button>
    </form>
  );
}

export function RevokeForm({ personId, ageGroup }: { personId: string; ageGroup: string }) {
  const [state, action, pending] = useActionState<AccessActionState, FormData>(
    revokeWaitingListAccess,
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="person_id" value={personId} />
      <input type="hidden" name="age_group" value={ageGroup} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        disabled={pending}
        className="min-h-[44px] lg:min-h-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      {state.notice && <span className="text-xs text-muted-foreground">{state.notice}</span>}
    </form>
  );
}
