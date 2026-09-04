"use client";

/**
 * "Members" — who is in this conversation, behind a button in the header
 * (Adam, 2026-08-25: "make group membership a separate button in the header
 * and not taking up space in the chat room").
 *
 * The list used to sit above the first message as a row of chips, which on a
 * phone pushed the conversation itself off the screen. It is the same list,
 * opened on demand: a button that says how many people are in the room, and a
 * panel that names them.
 *
 * Only the people actually IN the room are listed (Adam, 2026-09-04: "I don't
 * need to see left members 'In this conversation' so hide these") — their
 * history stays, their row here goes. A group's manager gets a remove button
 * beside each name ("Admin needs to be able to remove people from this view
 * though"): the same `removeGroupMember` the settings page uses, so SG-1's
 * refusals and the kept history are identical from either door.
 *
 * Names arrive already resolved by `loadThread()`, which reads them as the
 * caller. A name a link would bounce them from is not made a link: only the
 * committee, who may open /people/[id], get one.
 */

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserMinus, Users, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { removeGroupMember, type GroupActionState } from "../../groups/actions";

export type ThreadParticipant = {
  personId: string;
  name: string;
  isSelf: boolean;
  left: boolean;
  /** The hats beside the name — "Admin", "Coach U14 Mavericks" (Adam,
      2026-09-04). Resolved by the database, participant-gated. */
  labels?: string[];
};

const EMPTY: GroupActionState = {};

function RemoveButton({
  conversationId,
  personId,
  name,
}: {
  conversationId: string;
  personId: string;
  name: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(removeGroupMember, EMPTY);

  useEffect(() => {
    if (state.notice) router.refresh();
  }, [state.notice, router]);

  return (
    <form action={action} className="flex items-center">
      <input type="hidden" name="conversation_id" value={conversationId} />
      <input type="hidden" name="person_id" value={personId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Remove ${name} from this group`}
        title={state.error ?? `Remove ${name}`}
        className={
          "flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-destructive/10 " +
          (state.error ? "text-destructive" : "text-muted-foreground hover:text-destructive")
        }
      >
        <UserMinus className="h-4 w-4" />
      </button>
    </form>
  );
}

export function ParticipantsButton({
  participants,
  canOpenContacts,
  compact = false,
  footer,
  conversationId,
  canRemove = false,
}: {
  participants: ThreadParticipant[];
  canOpenContacts: boolean;
  /** Phone thread header: the icon and the count, with the word at lg. */
  compact?: boolean;
  /**
   * Anything that belongs at the foot of the panel — in practice Leave, which
   * is an action about who is in this conversation and so belongs with the
   * list of who is in it, rather than as its own block under the composer
   * where it cost a full row of the screen (Adam, 2026-09-01).
   */
  footer?: React.ReactNode;
  /** Needed only when `canRemove` — the group the remove buttons act on. */
  conversationId?: string;
  /** The group's manager: a remove button beside every other member. */
  canRemove?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click away and Escape both close it — a popover that can only be closed by
  // the button that opened it is a trap on a touch screen.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Somebody who has left is not "in this conversation" (Adam, 2026-09-04).
  const live = participants.filter((person) => !person.left);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={
          compact
            ? "inline-flex h-11 items-center gap-1 rounded-full px-2 text-sm text-muted-foreground hover:bg-secondary lg:h-auto lg:min-h-0 lg:rounded-none lg:px-0 lg:hover:bg-transparent lg:hover:underline"
            : "inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:underline lg:min-h-0"
        }
      >
        <Users className="h-4 w-4" />
        <span className={compact ? "sr-only lg:not-sr-only" : undefined}>Members</span>
        <span className="text-xs">({live.length})</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Members of this conversation"
          className="absolute right-0 z-30 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-xl border bg-card p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">In this conversation</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {live.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody else is in here yet.</p>
          ) : (
            <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
              {live.map((person) => (
                <li
                  key={person.personId}
                  className="flex min-h-[36px] items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0">
                    {canOpenContacts ? (
                      <Link
                        href={`/people/${person.personId}`}
                        className="block truncate underline-offset-2 hover:underline"
                      >
                        {person.name}
                      </Link>
                    ) : (
                      <span className="block truncate">{person.name}</span>
                    )}
                    {(person.labels ?? []).length > 0 && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {(person.labels ?? []).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {person.isSelf && <Badge variant="outline">You</Badge>}
                    {canRemove && conversationId && !person.isSelf && (
                      <RemoveButton
                        conversationId={conversationId}
                        personId={person.personId}
                        name={person.name}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {footer && <div className="mt-3 border-t pt-3">{footer}</div>}
        </div>
      )}
    </div>
  );
}
