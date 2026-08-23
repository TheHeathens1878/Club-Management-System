"use client";

/**
 * The group's own settings: its name and what it is attached to, plus closing
 * it.
 *
 * Only reachable for a conversation whose type is `group` — the server action
 * checks the type again before it writes. That is not belt and braces: team
 * rooms are found by TITLE inside `ensure_team_conversation()`, so renaming one
 * would quietly create a second room at the next membership change.
 */

import { useActionState } from "react";
import { Archive, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { AttachmentChoice } from "@/lib/group-scope";

import { AttachmentPicker } from "../attachment-picker";
import type { TeamOption, VenueGroupOption } from "../attachment-options";
import { closeGroup, updateGroup, type GroupActionState } from "../actions";

const EMPTY: GroupActionState = {};

function Feedback({ state }: { state: GroupActionState }) {
  if (state.error) {
    return (
      <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function GroupSettingsForm({
  conversationId,
  title,
  venues,
  teams,
  initialKind,
  initialResourceId,
  initialTeamId,
  initialScopeLabel,
  disabled,
}: {
  conversationId: string;
  title: string;
  venues: VenueGroupOption[];
  teams: TeamOption[];
  initialKind: AttachmentChoice;
  initialResourceId: string;
  initialTeamId: string;
  initialScopeLabel: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(updateGroup, EMPTY);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="conversation_id" value={conversationId} />

      <div className="space-y-1.5">
        <Label htmlFor="group-title">Group name</Label>
        <Input
          id="group-title"
          name="title"
          defaultValue={title}
          required
          maxLength={120}
          disabled={disabled}
        />
      </div>

      <AttachmentPicker
        venues={venues}
        teams={teams}
        initialKind={initialKind}
        initialResourceId={initialResourceId}
        initialTeamId={initialTeamId}
        initialScopeLabel={initialScopeLabel}
      />

      <Feedback state={state} />

      <Button type="submit" disabled={pending || disabled} className="gap-2">
        <Save className="h-4 w-4" /> Save changes
      </Button>
    </form>
  );
}

export function CloseGroupForm({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(closeGroup, EMPTY);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="conversation_id" value={conversationId} />
      <p className="text-sm text-muted-foreground">
        Closing a group stops anything new being posted. Nothing is deleted — what was said stays,
        and the people who were in it can still read it.
      </p>
      <Feedback state={state} />
      <Button type="submit" variant="outline" disabled={pending} className="gap-2">
        <Archive className="h-4 w-4" /> Close this group
      </Button>
    </form>
  );
}
