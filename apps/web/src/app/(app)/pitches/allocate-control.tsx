"use client";

/**
 * The one control that puts a fixture on a pitch, wherever it appears — the
 * unallocated list, the flagged list, and the grid's "Move to…" panel all use
 * this, so "Allocate" and "Move" cannot drift apart in either behaviour or
 * wording.
 *
 * Buffers are left blank by default and the pitch's own defaults are shown as
 * the placeholder: an admin who types nothing gets the club's standing rule,
 * and an admin who types something can see what they are overriding. A blank
 * box is resolved by `allocate_fixture()` itself — argument, then the team's
 * default, then the pitch's — so the hint says "or the team's" rather than
 * claiming the pitch always wins.
 *
 * A fixture whose team has a home pitch opens on it, labelled "(home)". Every
 * other pitch stays in the list: this is where the cursor starts, not a rule
 * about where the team may play.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, Loader2, ShieldAlert } from "lucide-react";
import { allocateFixture, unallocateFixture } from "./actions";

export type PitchOption = {
  id: string;
  name: string;
  defaultPreBufferMinutes: number;
  defaultPostBufferMinutes: number;
};

export function AllocateControl({
  fixtureId,
  pitches,
  currentResourceId = null,
  homeResourceId = null,
  allowUnallocate = false,
  compact = false,
}: {
  fixtureId: string;
  pitches: PitchOption[];
  currentResourceId?: string | null;
  /** `teams.home_resource_id` — where the select opens when nothing is set. */
  homeResourceId?: string | null;
  allowUnallocate?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  // An inactive or deleted home pitch is not in the list, so it cannot be the
  // starting value — fall back the way this control always has.
  const home = pitches.some((option) => option.id === homeResourceId) ? homeResourceId : null;
  const [resourceId, setResourceId] = useState(
    currentResourceId ?? home ?? pitches[0]?.id ?? "",
  );
  const [pre, setPre] = useState("");
  const [post, setPost] = useState("");
  const [busy, setBusy] = useState<null | "allocate" | "unallocate">(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const pitch = pitches.find((p) => p.id === resourceId);
  const unchanged = currentResourceId !== null && currentResourceId === resourceId;

  /** Blank means "the pitch's default"; anything else must be real minutes. */
  function parseBuffer(value: string): number | null | "invalid" {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const minutes = Number(trimmed);
    return Number.isInteger(minutes) && minutes >= 0 && minutes <= 600 ? minutes : "invalid";
  }

  async function runAllocate() {
    setError(null);
    setConflict(false);
    const pre_ = parseBuffer(pre);
    const post_ = parseBuffer(post);
    if (pre_ === "invalid" || post_ === "invalid") {
      setError("Buffers must be a whole number of minutes, or blank for the pitch's default.");
      return;
    }
    setBusy("allocate");
    const result = await allocateFixture({
      fixtureId,
      resourceId,
      preBufferMinutes: pre_,
      postBufferMinutes: post_,
    });
    setBusy(null);
    if (result.error) {
      setError(result.error);
      setConflict(result.conflict === true);
      return;
    }
    router.refresh();
  }

  async function runUnallocate() {
    setError(null);
    setConflict(false);
    setBusy("unallocate");
    const result = await unallocateFixture(fixtureId);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      setConflict(result.conflict === true);
      return;
    }
    router.refresh();
  }

  if (pitches.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No active pitches. Add one under Room Bookings → Rooms &amp; resources first.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[10rem] flex-1">
          {!compact && <span className="mb-1 block text-xs text-muted-foreground">Pitch</span>}
          <select
            aria-label="Pitch"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {pitches.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.id === currentResourceId ? " (current)" : ""}
                {option.id === home ? " (home)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="w-24">
          {!compact && <span className="mb-1 block text-xs text-muted-foreground">Pre (min)</span>}
          <Input
            aria-label="Pre-match buffer in minutes"
            inputMode="numeric"
            value={pre}
            onChange={(e) => setPre(e.target.value)}
            placeholder={String(pitch?.defaultPreBufferMinutes ?? 0)}
            className="h-9"
          />
        </label>
        <label className="w-24">
          {!compact && <span className="mb-1 block text-xs text-muted-foreground">Post (min)</span>}
          <Input
            aria-label="Post-match buffer in minutes"
            inputMode="numeric"
            value={post}
            onChange={(e) => setPost(e.target.value)}
            placeholder={String(pitch?.defaultPostBufferMinutes ?? 0)}
            className="h-9"
          />
        </label>
        <Button size="sm" onClick={runAllocate} disabled={busy !== null || !resourceId}>
          {busy === "allocate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {currentResourceId === null ? "Allocate" : unchanged ? "Re-allocate" : "Move here"}
        </Button>
        {allowUnallocate && (
          <Button size="sm" variant="outline" onClick={runUnallocate} disabled={busy !== null}>
            {busy === "unallocate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Unallocate
          </Button>
        )}
      </div>

      {pitch && (
        <p className="text-[11px] text-muted-foreground">
          Leave the buffers blank to use the team&apos;s defaults, or {pitch.name}&apos;s where the
          team has none — {pitch.defaultPreBufferMinutes} min before,{" "}
          {pitch.defaultPostBufferMinutes} min after.
        </p>
      )}

      {error && (
        <p
          className={
            conflict
              ? "flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800"
              : "flex items-start gap-1.5 text-xs text-destructive"
          }
        >
          {conflict ? (
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          {/* Verbatim from the database: it names the bookings in the way. */}
          <span className="break-words">{error}</span>
        </p>
      )}
    </div>
  );
}
