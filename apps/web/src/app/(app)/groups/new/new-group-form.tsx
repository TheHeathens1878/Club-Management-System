"use client";

/**
 * Set up a group.
 *
 * The member list is a stack of `PersonPicker`s, each contributing one hidden
 * `person_id` input, so the whole thing stays a plain server-action form and
 * the search keeps going through `searchPeople` under the caller's own RLS —
 * no roster is shipped to the browser.
 *
 * Nothing is added optimistically and nothing is reworded: if the database
 * refuses a member (SG-1 — an adult and a child alone in a room needs the
 * child's parent or guardian in it) the refusal below is its own sentence,
 * naming the rule and the person.
 */

import { useActionState, useState } from "react";
import { Plus, UsersRound, X } from "lucide-react";

import { PersonPicker } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

import { AttachmentPicker } from "../attachment-picker";
import type { TeamOption, VenueGroupOption } from "../attachment-options";
import { createGroup, type GroupActionState } from "../actions";

const EMPTY: GroupActionState = {};

export function NewGroupForm({
  venues,
  teams,
  myPersonId,
}: {
  venues: VenueGroupOption[];
  teams: TeamOption[];
  myPersonId: string;
}) {
  const [state, action, pending] = useActionState(createGroup, EMPTY);
  // Stable keys, so removing a row does not re-key the pickers below it and
  // throw away what they had chosen.
  const [rows, setRows] = useState<number[]>([0]);
  const [nextKey, setNextKey] = useState(1);

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="group-title">Group name</Label>
        <Input
          id="group-title"
          name="title"
          required
          maxLength={120}
          placeholder="e.g. Ashton Park Saturday crew"
          className="h-11 lg:h-10"
        />
      </div>

      <AttachmentPicker venues={venues} teams={teams} initialKind="resource" />

      <div className="space-y-2">
        <Label>Who is in it</Label>
        <div className="space-y-3">
          {rows.map((key, index) => (
            <div key={key} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <PersonPicker
                  id={`group-member-${key}`}
                  name="person_id"
                  label={`Member ${index + 1}`}
                  excludeIds={[myPersonId]}
                />
              </div>
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setRows((current) => current.filter((k) => k !== key))}
                  aria-label={`Remove member ${index + 1}`}
                  className="h-11 w-11 lg:h-10 lg:w-10"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] w-full gap-1.5 sm:w-auto lg:min-h-0"
          onClick={() => {
            setRows((current) => [...current, nextKey]);
            setNextKey((n) => n + 1);
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Add another person
        </Button>
        <p className="text-xs text-muted-foreground">
          You are added automatically. Members are added one at a time, so if one of them is refused
          you will be told exactly who and why — and the group is not left half-built.
        </p>
      </div>

      {state.error && (
        <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending}
        className="min-h-[44px] w-full gap-2 sm:w-auto lg:min-h-0"
      >
        <UsersRound className="h-4 w-4" /> Create group
      </Button>
    </form>
  );
}
