/**
 * Squad photos for the FA Clubs Portal, as one zip: a folder per team, and
 * inside it one file per player named after the player (Adam, 2026-08-25:
 * "the photos should be named by the player name"; 2026-09-06: "folder for
 * the team, then the photo filename should be the player's name"). Shared by
 * the single-team route on the team page and the multi-team export from the
 * teams table, so the archive is the same shape whichever door opened it.
 *
 * The roster read is the CALLER'S: RLS decides which teams and which people
 * they may see. Only the bytes come from the service-role client, because
 * the `person-photos` bucket is private and `person_photos_read` would admit
 * an administrator anyway — the service key fetches many files without
 * minting a signed URL per photo, on routes already gated on club_admin.
 */

import { personLabel } from "@/lib/people-display";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { zipSafeName, type ZipEntry } from "@/lib/zip";

/** The bucket's `allowed_mime_types`, as file extensions. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** A few squads, not a season archive: a ceiling that keeps this one response. */
export const MAX_PHOTOS = 600;

/**
 * The extension to give the file in the archive. The stored path wins — it is
 * what the upload actually named — and the content type is the fallback for a
 * path that carries no suffix.
 */
export function extensionFor(path: string, contentType: string | undefined): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const suffix = base.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(suffix)) return suffix;
  }
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return EXTENSION_BY_TYPE[type] ?? "jpg";
}

export type TeamPhotosResult =
  | { ok: true; entries: ZipEntry[]; teams: { id: string; name: string; players: number; photos: number }[]; missing: number }
  | { ok: false; status: number; message: string };

/**
 * Build the archive's entries for these teams. Entry names are
 * `<Team>/<First Last>.<ext>`; a second Tom Smith in the same team becomes
 * `Tom Smith (2).jpg`. A `missing.txt` at the root lists, per team, who has
 * no photo on file.
 */
export async function buildTeamPhotoEntries(teamIds: string[]): Promise<TeamPhotosResult> {
  const supabase = await createClient();

  const { data: teamRows, error: teamError } = await supabase
    .from("teams")
    .select("id,name")
    .in("id", teamIds);
  if (teamError) return { ok: false, status: 500, message: `Could not read the teams: ${teamError.message}` };
  const teams = (teamRows ?? []).sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  if (teams.length === 0) return { ok: false, status: 404, message: "No such team." };

  // Live players: a membership that has not ended. Someone who plays for the
  // team in two seasons at once has two rows and one face, so the roster is
  // deduplicated by person within each team.
  const { data: rows, error } = await supabase
    .from("team_memberships")
    .select("team_id,person_id,people(first_name,last_name,preferred_name,photo_path)")
    .in("team_id", teams.map((t) => t.id))
    .eq("role", "player")
    .is("left_at", null);
  if (error) return { ok: false, status: 500, message: `Could not read the squads: ${error.message}` };

  type Player = { teamId: string; personId: string; name: string; photoPath: string | null };
  const seen = new Set<string>();
  const players: Player[] = [];
  for (const row of rows ?? []) {
    const key = `${row.team_id}|${row.person_id}`;
    if (!row.people || seen.has(key)) continue;
    seen.add(key);
    players.push({
      teamId: row.team_id,
      personId: row.person_id,
      name: personLabel(row.people),
      photoPath: row.people.photo_path,
    });
  }

  const withPhotos = players.filter((player) => player.photoPath);
  if (withPhotos.length > MAX_PHOTOS) {
    return {
      ok: false,
      status: 413,
      message: `Those squads have ${withPhotos.length} photos; this export handles up to ${MAX_PHOTOS}. Tick fewer teams.`,
    };
  }

  // One person on two teams has one face: fetch each photo once.
  const admin = createAdminClient();
  const bytesByPath = new Map<string, { bytes: Uint8Array; contentType: string } | null>();
  await Promise.all(
    Array.from(new Set(withPhotos.map((p) => p.photoPath!))).map(async (path) => {
      const { data, error: downloadError } = await admin.storage.from("person-photos").download(path);
      if (downloadError || !data) {
        bytesByPath.set(path, null);
        return;
      }
      bytesByPath.set(path, { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type });
    }),
  );

  const entries: ZipEntry[] = [];
  const missingLines: string[] = [];
  const summary: { id: string; name: string; players: number; photos: number }[] = [];
  let missing = 0;

  for (const team of teams) {
    const folder = zipSafeName(team.name);
    const roster = players
      .filter((p) => p.teamId === team.id)
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
    const used = new Map<string, number>();
    const teamMissing: string[] = [];
    let photos = 0;

    for (const player of roster) {
      if (!player.photoPath) {
        teamMissing.push(`${player.name} — no photo on file`);
        continue;
      }
      const file = bytesByPath.get(player.photoPath);
      if (!file) {
        teamMissing.push(`${player.name} — the photo file could not be read`);
        continue;
      }
      const stem = zipSafeName(player.name);
      const n = (used.get(stem.toLowerCase()) ?? 0) + 1;
      used.set(stem.toLowerCase(), n);
      const suffix = n === 1 ? "" : ` (${n})`;
      entries.push({
        name: `${folder}/${stem}${suffix}.${extensionFor(player.photoPath, file.contentType)}`,
        data: file.bytes,
      });
      photos += 1;
    }

    teamMissing.sort((a, b) => a.localeCompare(b, "en-GB"));
    missing += teamMissing.length;
    summary.push({ id: team.id, name: team.name, players: roster.length, photos });
    missingLines.push(
      teamMissing.length === 0
        ? `${team.name}: every player has a photo.`
        : `${team.name}: ${teamMissing.length} of ${roster.length} players have no photo in this archive:`,
      ...teamMissing.map((line) => `  ${line}`),
      "",
    );
  }

  entries.push({
    name: "missing.txt",
    data: new TextEncoder().encode(missingLines.join("\r\n") + "\r\n"),
  });

  return { ok: true, entries, teams: summary, missing };
}
