"use client";

import { useActionState, useState } from "react";
import { MessageSquarePlus } from "lucide-react";

import { Input, Label } from "@/components/ui/input";

import { startConversation, type ActionState } from "../actions";

const EMPTY: ActionState = {};

export type PersonOption = { id: string; name: string };

/**
 * Start a DM or a group.
 *
 * The person list is whatever `people` RLS lets this user see — for most
 * members that is themselves and their own children, and that is the correct
 * answer, not a bug to work around. Team rooms are joined by being on the
 * team, so they are links rather than options here.
 *
 * SG-1 refusals come back from the database naming the rule and are shown
 * unchanged.
 */
export function NewMessageForm({ people }: { people: PersonOption[] }) {
  const [state, action, pending] = useActionState(startConversation, EMPTY);
  const [type, setType] = useState<"dm" | "group">("dm");
  const [query, setQuery] = useState("");

  const filtered = query
    ? people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : people;

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="conversation-type">Conversation</Label>
        <select
          id="conversation-type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value === "group" ? "group" : "dm")}
          className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
        >
          <option value="dm">Direct message (one person)</option>
          <option value="group">Group (two or more people)</option>
        </select>
      </div>

      {type === "group" && (
        <div className="space-y-1.5">
          <Label htmlFor="conversation-title">Group name</Label>
          <Input id="conversation-title" name="title" placeholder="e.g. Saturday transport" />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="people-search">Who</Label>
        <Input
          id="people-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the people you can message"
        />
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
          {filtered.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">
              Nobody to show. Members can normally message the people on their teams and, as a
              parent, their own children; administrators see everyone.
            </p>
          )}
          {filtered.map((person) => (
            <label key={person.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary">
              <input
                type={type === "dm" ? "radio" : "checkbox"}
                name="person_id"
                value={person.id}
                className="h-4 w-4"
              />
              {person.name}
            </label>
          ))}
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        <MessageSquarePlus className="h-4 w-4" /> Start conversation
      </button>
    </form>
  );
}
