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
 * Rendering only — the names arrive already resolved by `loadThread()`, which
 * reads them as the caller. A name a link would bounce them from is not made a
 * link: only the committee, who may open /people/[id], get one.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Users, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export type ThreadParticipant = {
  personId: string;
  name: string;
  isSelf: boolean;
  left: boolean;
};

export function ParticipantsButton({
  participants,
  canOpenContacts,
}: {
  participants: ThreadParticipant[];
  canOpenContacts: boolean;
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

  const live = participants.filter((person) => !person.left);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:underline lg:min-h-0"
      >
        <Users className="h-4 w-4" /> Members
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

          {participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody else is in here yet.</p>
          ) : (
            <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
              {participants.map((person) => (
                <li
                  key={`${person.personId}-${person.left ? "left" : "live"}`}
                  className="flex min-h-[36px] items-center justify-between gap-2 text-sm"
                >
                  {canOpenContacts ? (
                    <Link
                      href={`/people/${person.personId}`}
                      className="truncate underline-offset-2 hover:underline"
                    >
                      {person.name}
                    </Link>
                  ) : (
                    <span className="truncate">{person.name}</span>
                  )}
                  {person.isSelf && <Badge variant="outline">You</Badge>}
                  {person.left && <Badge variant="muted">Left</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
