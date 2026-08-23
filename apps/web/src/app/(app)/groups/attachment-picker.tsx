"use client";

/**
 * "What is this group about?" — the one place the three attachment columns are
 * chosen between.
 *
 * The database allows at most one of `team_id` / `resource_id`, so this is a
 * single choice rather than three independent fields: picking one renders that
 * field and posts nothing for the others, which is what keeps the check
 * constraint a backstop instead of a hazard.
 */

import { useState } from "react";

import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { isAttachmentChoice, type AttachmentChoice } from "@/lib/group-scope";

import type { TeamOption, VenueGroupOption } from "./attachment-options";

export function AttachmentPicker({
  venues,
  teams,
  initialKind = "none",
  initialResourceId = "",
  initialTeamId = "",
  initialScopeLabel = "",
}: {
  venues: VenueGroupOption[];
  teams: TeamOption[];
  initialKind?: AttachmentChoice;
  initialResourceId?: string;
  initialTeamId?: string;
  initialScopeLabel?: string;
}) {
  const [kind, setKind] = useState<AttachmentChoice>(initialKind);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="attachment-kind">What is this group about?</Label>
        <Select
          id="attachment-kind"
          name="attachment_kind"
          value={kind}
          onChange={(e) => setKind(isAttachmentChoice(e.target.value) ? e.target.value : "none")}
        >
          <option value="resource">A venue, pitch or room</option>
          <option value="team">A team</option>
          <option value="label">Anything else</option>
          <option value="none">Nothing in particular</option>
        </Select>
      </div>

      {kind === "resource" && (
        <div className="space-y-1.5">
          <Label htmlFor="attachment-resource">Venue</Label>
          <Select id="attachment-resource" name="resource_id" defaultValue={initialResourceId}>
            <option value="">Choose a venue…</option>
            {venues.map((group) => (
              <optgroup key={group.venue} label={group.venue}>
                {group.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          {venues.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No pitches or rooms are in use yet. Add them under Pitches or Rooms first.
            </p>
          )}
        </div>
      )}

      {kind === "team" && (
        <div className="space-y-1.5">
          <Label htmlFor="attachment-team">Team</Label>
          <Select id="attachment-team" name="team_id" defaultValue={initialTeamId}>
            <option value="">Choose a team…</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            This is a group that happens to be about a team. It is not the team room — team rooms
            manage their own membership and are not edited here.
          </p>
        </div>
      )}

      {kind === "label" && (
        <div className="space-y-1.5">
          <Label htmlFor="attachment-label">What it is about</Label>
          <Input
            id="attachment-label"
            name="scope_label"
            defaultValue={initialScopeLabel}
            placeholder="e.g. Presentation night, Minibus rota, Committee"
            maxLength={120}
          />
        </div>
      )}
    </div>
  );
}
