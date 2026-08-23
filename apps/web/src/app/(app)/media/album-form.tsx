"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";

import { Textarea } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";

import { createAlbum, type ActionState } from "./actions";

const EMPTY: ActionState = {};
const selectClass = "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";

export type Option = { id: string; name: string };

/**
 * The visibility is not decoration: it selects which photo consent every minor
 * in the album must hold (team album, club website, social media, press). Say
 * so on the form, because choosing "social" is a decision about children's
 * data, not a display setting.
 */
export function AlbumForm({ teams, seasons }: { teams: Option[]; seasons: Option[] }) {
  const [state, action, pending] = useActionState(createAlbum, EMPTY);
  const [visibility, setVisibility] = useState("team");

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="album-title">Title *</Label>
          <Input id="album-title" name="title" placeholder="e.g. U12s v Sale, 14 Sept" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="album-visibility">Visibility *</Label>
          <select
            id="album-visibility"
            name="visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className={selectClass}
          >
            <option value="team">Team album — needs team-album consent</option>
            <option value="club">Club website — needs website consent</option>
            <option value="public">Public — needs website consent</option>
            <option value="social">Social media — needs social-media consent</option>
            <option value="press">Press — needs press consent</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="album-team">Team {visibility === "team" ? "*" : ""}</Label>
          <select id="album-team" name="team_id" className={selectClass} defaultValue="">
            <option value="">No team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="album-season">Season</Label>
          <select id="album-season" name="season_id" className={selectClass} defaultValue="">
            <option value="">No season</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="album-description">Description</Label>
        <Textarea id="album-description" name="description" rows={2} />
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

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        <Plus className="h-4 w-4" /> Create album
      </button>
    </form>
  );
}
