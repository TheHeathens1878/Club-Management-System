"use client";

/**
 * Compose a lobby post (Adam, 2026-08-25): club-wide (optionally pushed onto
 * every team's bulletin board), or aimed at chosen teams and whole age groups.
 * The database re-checks everything — who may post, which teams a coach may
 * target — and expands age groups to teams at posting time.
 */

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { createLobbyPost, type LobbyActionState } from "../actions";

const EMPTY: LobbyActionState = {};

export type TeamOption = { id: string; name: string };

export function PostForm({
  teams,
  ageGroups,
  isAdmin,
}: {
  teams: TeamOption[];
  ageGroups: string[];
  isAdmin: boolean;
}) {
  const [state, action, saving] = useActionState(createLobbyPost, EMPTY);
  const [audience, setAudience] = useState<"club" | "targeted">("club");

  return (
    <form action={action} className="max-w-xl space-y-4">
      {state.error ? (
        <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="post-title" className="text-sm font-medium">
          Title
        </label>
        <Input id="post-title" name="title" required maxLength={160} placeholder="What is this about?" />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="post-body" className="text-sm font-medium">
          The post
        </label>
        <textarea
          id="post-body"
          name="body"
          required
          maxLength={4000}
          rows={6}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          placeholder="Say it the way you'd say it at the clubhouse."
        />
      </div>

      <div className="space-y-2 rounded-lg border p-4">
        <span className="text-sm font-medium">Who is it for?</span>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="audience_mode"
              checked={audience === "club"}
              onChange={() => setAudience("club")}
              className="mt-1"
            />
            <span>
              The whole club
              <span className="block text-xs text-muted-foreground">
                Everyone sees it in the lobby.
              </span>
            </span>
          </label>
          {audience === "club" ? (
            <label className="ml-6 flex items-start gap-2">
              <input type="checkbox" name="push_to_boards" value="true" className="mt-1" />
              <span>
                Also push it onto every team&apos;s bulletin board
                <span className="block text-xs text-muted-foreground">
                  It appears on each board with a club-wide chip — replies still come back to the
                  one thread here.
                </span>
              </span>
            </label>
          ) : null}
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="audience_mode"
              checked={audience === "targeted"}
              onChange={() => setAudience("targeted")}
              className="mt-1"
            />
            <span>
              Certain teams or age groups only
              <span className="block text-xs text-muted-foreground">
                It lands on those teams&apos; boards and only their people see it in the lobby.
              </span>
            </span>
          </label>
        </div>

        {audience === "targeted" ? (
          <div className="ml-6 grid gap-4 pt-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Age groups
              </span>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
                {ageGroups.map((ageGroup) => (
                  <label key={ageGroup} className="flex items-center gap-2">
                    <input type="checkbox" name="age_groups" value={ageGroup} />
                    {ageGroup}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Teams
              </span>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
                {teams.map((team) => (
                  <label key={team.id} className="flex items-center gap-2">
                    <input type="checkbox" name="team_ids" value={team.id} />
                    {team.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {isAdmin ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pinned" value="true" />
          Pin it to the top of the board
        </label>
      ) : null}

      <Button type="submit" disabled={saving}>
        {saving ? "Posting…" : "Post"}
      </Button>
      <p className="text-xs text-muted-foreground">
        A targeted post also tells its people in the app. Club-wide posts live in the lobby for
        everyone.
      </p>
    </form>
  );
}
