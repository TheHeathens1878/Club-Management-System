"use client";

/**
 * Priorities mode (gap 10) — the running order within one age group.
 *
 * The order is held locally while it is being shuffled and written in one go:
 * a save renumbers the whole group 1..n, so the numbers stay dense and two
 * entries can never share a place. Nothing is written until "Save order" is
 * pressed, and the database refuses the write outright for anyone who is not a
 * club administrator.
 */

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, ListOrdered } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_LABELS, statusVariant, type WaitingListStatus } from "@/lib/waiting-list";

import { setWaitingListPriorities, type WaitingListActionState } from "./actions";

export type PriorityEntry = {
  id: string;
  playerName: string;
  status: WaitingListStatus;
  priority: number | null;
};

export type PriorityGroup = { ageGroup: string; entries: PriorityEntry[] };

function GroupOrder({ group }: { group: PriorityGroup }) {
  const [order, setOrder] = useState<PriorityEntry[]>(group.entries);
  const [state, action, pending] = useActionState<WaitingListActionState, FormData>(
    setWaitingListPriorities,
    {},
  );

  function move(index: number, delta: number) {
    setOrder((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = current.slice();
      const moved = next[index];
      const displaced = next[target];
      if (!moved || !displaced) return current;
      next[index] = displaced;
      next[target] = moved;
      return next;
    });
  }

  function setPosition(index: number, rawValue: string) {
    const wanted = Number(rawValue);
    if (!Number.isFinite(wanted)) return;
    setOrder((current) => {
      const target = Math.min(Math.max(Math.round(wanted), 1), current.length) - 1;
      if (target === index) return current;
      const next = current.slice();
      const [moved] = next.splice(index, 1);
      if (!moved) return current;
      next.splice(target, 0, moved);
      return next;
    });
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border bg-card p-4">
      <input type="hidden" name="age_group" value={group.ageGroup} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{group.ageGroup}</Badge>
        <span className="text-sm text-muted-foreground">
          {order.length} {order.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <ol className="space-y-1.5">
        {order.map((entry, index) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/40 px-3 py-2 text-sm"
          >
            <input type="hidden" name="entry_id" value={entry.id} />
            <label className="sr-only" htmlFor={`position-${entry.id}`}>
              Position for {entry.playerName}
            </label>
            <input
              id={`position-${entry.id}`}
              type="number"
              min={1}
              max={order.length}
              value={index + 1}
              onChange={(event) => setPosition(index, event.target.value)}
              className="h-8 w-16 rounded-md border border-input bg-card px-2 text-sm"
            />
            <span className="font-medium">{entry.playerName}</span>
            <Badge variant={statusVariant(entry.status)}>{STATUS_LABELS[entry.status]}</Badge>
            {entry.priority !== null && entry.priority !== index + 1 && (
              <span className="text-xs text-muted-foreground">was {entry.priority}</span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${entry.playerName} up`}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => move(index, 1)}
                disabled={index === order.length - 1}
                aria-label={`Move ${entry.playerName} down`}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
            </span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save order"}
        </Button>
        {state.error && <span className="text-sm text-destructive">{state.error}</span>}
        {state.notice && <span className="text-sm text-muted-foreground">{state.notice}</span>}
      </div>
    </form>
  );
}

export function PrioritiesPanel({ groups }: { groups: PriorityGroup[] }) {
  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No entries to order. Clear the filters, or choose an age group with people waiting.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ListOrdered className="mt-0.5 h-4 w-4 shrink-0" />
        Put each age group in the order you would offer places. Saving renumbers that group from 1,
        and the desk lists people in that order from then on.
      </p>
      {groups.map((group) => (
        <GroupOrder key={group.ageGroup} group={group} />
      ))}
    </div>
  );
}
