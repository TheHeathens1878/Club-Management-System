"use client";

/**
 * Who is in the group, with the two edits an administrator needs.
 *
 * No optimistic UI: a row appears or disappears only after the server action
 * has come back, because the SG-1 guard can refuse either direction — adding
 * somebody can leave one adult alone with one child, and so can removing
 * somebody. When it refuses, the database's own sentence is what is shown; it
 * names the rule and the people, and rewriting it would throw that away.
 *
 * SG-2: a removal stamps `left_at`. The row stays, and so does the history.
 */

import Link from "next/link";
import { useActionState } from "react";
import { UserPlus, UserMinus } from "lucide-react";

import { PersonPicker } from "@/components/person-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatStamp } from "@/lib/people-display";

import { addGroupMember, removeGroupMember, type GroupActionState } from "../actions";

const EMPTY: GroupActionState = {};

export type GroupMemberRow = {
  personId: string;
  name: string;
  basis: string;
  joinedAt: string;
  leftAt: string | null;
};

const BASIS_LABELS: Record<string, string> = {
  creator: "Set the group up",
  member: "Member",
  staff: "Staff",
  guardian: "Parent or guardian",
  oversight: "Oversight",
};

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

function RemoveMemberForm({
  conversationId,
  member,
}: {
  conversationId: string;
  member: GroupMemberRow;
}) {
  const [state, action, pending] = useActionState(removeGroupMember, EMPTY);

  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="conversation_id" value={conversationId} />
        <input type="hidden" name="person_id" value={member.personId} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={pending}
          className="min-h-[44px] gap-1.5 lg:min-h-0"
        >
          <UserMinus className="h-3.5 w-3.5" /> Remove
        </Button>
      </form>
      <Feedback state={state} />
    </div>
  );
}

export function GroupMembersPanel({
  conversationId,
  members,
  canEdit,
  canOpenContacts = false,
  closed,
}: {
  conversationId: string;
  members: GroupMemberRow[];
  canEdit: boolean;
  /** The caller may open /people/[id] — the committee, and nobody else. */
  canOpenContacts?: boolean;
  closed: boolean;
}) {
  const [state, action, pending] = useActionState(addGroupMember, EMPTY);
  const active = members.filter((m) => m.leftAt === null);
  const past = members.filter((m) => m.leftAt !== null);
  const excludeIds = active.map((m) => m.personId);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {active.length === 0 && (
          <p className="text-sm text-muted-foreground">Nobody is in this group.</p>
        )}
        {active.map((member) => (
          <div
            key={member.personId}
            className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {canOpenContacts ? (
                  <Link
                    href={`/people/${member.personId}`}
                    className="text-sm font-medium underline underline-offset-2 hover:text-primary"
                  >
                    {member.name}
                  </Link>
                ) : (
                  <span className="text-sm font-medium">{member.name}</span>
                )}
                <Badge variant="muted">{BASIS_LABELS[member.basis] ?? member.basis}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                In since {formatStamp(member.joinedAt)}
              </p>
            </div>
            {canEdit && !closed && (
              <RemoveMemberForm conversationId={conversationId} member={member} />
            )}
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Previously in this group</p>
          <div className="flex flex-wrap gap-2">
            {past.map((member) =>
              canOpenContacts ? (
                <Link key={`${member.personId}-${member.leftAt}`} href={`/people/${member.personId}`}>
                  <Badge variant="outline" className="hover:bg-secondary">
                    {member.name} · left {formatStamp(member.leftAt)}
                  </Badge>
                </Link>
              ) : (
                <Badge key={`${member.personId}-${member.leftAt}`} variant="outline">
                  {member.name} · left {formatStamp(member.leftAt)}
                </Badge>
              ),
            )}
          </div>
        </div>
      )}

      {canEdit && !closed && (
        <form action={action} className="space-y-3 rounded-lg border bg-secondary/30 p-3">
          <input type="hidden" name="conversation_id" value={conversationId} />
          <PersonPicker
            id="group-add-member"
            name="person_id"
            label="Add somebody"
            excludeIds={excludeIds}
            required
          />
          <Feedback state={state} />
          <Button
            type="submit"
            size="sm"
            disabled={pending}
            className="min-h-[44px] w-full gap-1.5 sm:w-auto lg:min-h-0"
          >
            <UserPlus className="h-3.5 w-3.5" /> Add to group
          </Button>
        </form>
      )}

      {closed && (
        <p className="text-sm text-muted-foreground">
          This group is closed, so its membership is fixed.
        </p>
      )}
    </div>
  );
}
