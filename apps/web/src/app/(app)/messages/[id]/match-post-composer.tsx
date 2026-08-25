"use client";

/**
 * "Post a game" — the Referees group's structured composer (Adam, 2026-08-25):
 * pick one of your team's fixtures (length, format, location, date and KO
 * auto-complete) or free-type one; surface and match fee round it off. The
 * action writes the message and its card in one go.
 */

import { useActionState, useState } from "react";
import { ChevronDown, Loader2, Megaphone } from "lucide-react";

import { Input, Label } from "@/components/ui/input";

import { postMatchGame, type RefereeActionState } from "./referee-actions";

export type FixtureOption = {
  id: string;
  /** "U12 Arrows v Sale United (U12)" — the card's headline, age group included. */
  label: string;
  durationText: string;
  formatText: string;
  locationText: string;
  /** "YYYY-MM-DD" and "HH:mm", Europe/London. */
  kickoffDate: string;
  kickoffTime: string;
};

const EMPTY: RefereeActionState = {};

export function MatchPostComposer({
  conversationId,
  fixtures,
}: {
  conversationId: string;
  fixtures: FixtureOption[];
}) {
  const [state, action, posting] = useActionState(postMatchGame, EMPTY);
  const [open, setOpen] = useState(false);
  const [fixtureId, setFixtureId] = useState("");
  const [fixtureText, setFixtureText] = useState("");
  const [durationText, setDurationText] = useState("");
  const [formatText, setFormatText] = useState("");
  const [locationText, setLocationText] = useState("");
  const [kickoffDate, setKickoffDate] = useState("");
  const [kickoffTime, setKickoffTime] = useState("");

  function pickFixture(id: string) {
    setFixtureId(id);
    const fixture = fixtures.find((option) => option.id === id);
    if (!fixture) return;
    setFixtureText(fixture.label);
    setDurationText(fixture.durationText);
    setFormatText(fixture.formatText);
    setLocationText(fixture.locationText);
    setKickoffDate(fixture.kickoffDate);
    setKickoffTime(fixture.kickoffTime);
  }

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold"
      >
        <span className="inline-flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary" /> Post a game that needs a referee
        </span>
        <ChevronDown className={"h-4 w-4 transition-transform" + (open ? " rotate-180" : "")} />
      </button>

      {open && (
        <form action={action} className="space-y-3 border-t px-4 py-3">
          <input type="hidden" name="conversation_id" value={conversationId} />
          <input type="hidden" name="fixture_id" value={fixtureId} />

          {fixtures.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="rp-fixture">Your team&apos;s fixtures</Label>
              <select
                id="rp-fixture"
                value={fixtureId}
                onChange={(event) => pickFixture(event.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Free-type the details below…</option>
                {fixtures.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} — {option.kickoffDate} {option.kickoffTime}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rp-details">Fixture details (include the age group) *</Label>
            <Input
              id="rp-details"
              name="fixture_text"
              required
              value={fixtureText}
              onChange={(event) => setFixtureText(event.target.value)}
              placeholder="e.g. Longford Park U9 v Sale Sharks"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rp-length">Length of game</Label>
              <Input
                id="rp-length"
                name="duration_text"
                value={durationText}
                onChange={(event) => setDurationText(event.target.value)}
                placeholder="e.g. 50 mins"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-format">Format</Label>
              <Input
                id="rp-format"
                name="format_text"
                value={formatText}
                onChange={(event) => setFormatText(event.target.value)}
                placeholder="e.g. 9v9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-location">Location</Label>
            <Input
              id="rp-location"
              name="location_text"
              value={locationText}
              onChange={(event) => setLocationText(event.target.value)}
              placeholder="e.g. Longford Park, M32 8QS"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="rp-surface">Surface</Label>
              <select
                id="rp-surface"
                name="surface"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                defaultValue=""
              >
                <option value="">—</option>
                <option value="Grass">Grass</option>
                <option value="3G">3G</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-date">Date</Label>
              <Input
                id="rp-date"
                name="kickoff_date"
                type="date"
                value={kickoffDate}
                onChange={(event) => setKickoffDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-time">KO time</Label>
              <Input
                id="rp-time"
                name="kickoff_time"
                type="time"
                value={kickoffTime}
                onChange={(event) => setKickoffTime(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-fee">Match fee</Label>
            <Input id="rp-fee" name="fee_text" placeholder="e.g. £20" className="sm:w-40" />
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          {state.notice && <p className="text-sm text-emerald-700">{state.notice}</p>}

          <button
            type="submit"
            disabled={posting}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {posting && <Loader2 className="h-4 w-4 animate-spin" />} Post to the referees
          </button>
        </form>
      )}
    </div>
  );
}
