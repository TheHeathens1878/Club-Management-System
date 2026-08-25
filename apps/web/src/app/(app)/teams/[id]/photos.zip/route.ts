import { NextResponse } from "next/server";

import { writeAudit } from "@/lib/audit";
import { getSessionProfile } from "@/lib/auth";
import { personLabel } from "@/lib/people-display";
import { isClubAdmin } from "@/lib/person";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildZip, zipSafeName, type ZipEntry } from "@/lib/zip";

/**
 * Every live player's photo for one team, as a zip named by the player
 * (Adam, 2026-08-25: "export team contacts (players) photos to a zip file.
 * The photos should be named by the player name").
 *
 * CLUB ADMINISTRATORS ONLY. A squad's faces leaving the building in one file
 * is a different act from a coach seeing an avatar on the roster, so the gate
 * is `is_club_admin()` — the `person_roles` answer, asked through the caller's
 * own client — and nothing else. A committee sign-in that holds club_admin
 * passes on that, not on `profiles.role`.
 *
 * The roster read is the CALLER'S: RLS decides which team and which people
 * they may see. Only the bytes come from the service-role client, because the
 * `person-photos` bucket is private and `person_photos_read` would admit an
 * administrator anyway — the service key is here to fetch many files without
 * minting a signed URL per photo, on a route already gated on club_admin
 * above, and for no other reason.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The bucket's `allowed_mime_types`, as file extensions. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** A squad, not a season archive: a ceiling that keeps this a single response. */
const MAX_PHOTOS = 200;

/**
 * The extension to give the file in the archive. The stored path wins — it is
 * what the upload actually named — and the content type is the fallback for a
 * path that carries no suffix.
 */
function extensionFor(path: string, contentType: string | undefined): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const suffix = base.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(suffix)) return suffix;
  }
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return EXTENSION_BY_TYPE[type] ?? "jpg";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const session = await getSessionProfile();
  if (!session) return new NextResponse("Sign in first.", { status: 401 });
  if (!(await isClubAdmin())) {
    return new NextResponse("The squad photo export is for club administrators.", { status: 403 });
  }

  const supabase = await createClient();

  const { data: team } = await supabase
    .from("teams")
    .select("id,name")
    .eq("id", id)
    .maybeSingle();
  if (!team) return new NextResponse("No such team.", { status: 404 });

  // Live players: a membership that has not ended. Someone who plays for the
  // team in two seasons at once has two rows and one face, so the roster is
  // deduplicated by person below.
  const { data: rows, error } = await supabase
    .from("team_memberships")
    .select("person_id,people(first_name,last_name,preferred_name,photo_path)")
    .eq("team_id", id)
    .eq("role", "player")
    .is("left_at", null);
  if (error) return new NextResponse(`Could not read the squad: ${error.message}`, { status: 500 });

  const players = new Map<string, { name: string; photoPath: string | null }>();
  for (const row of rows ?? []) {
    if (!row.people || players.has(row.person_id)) continue;
    players.set(row.person_id, {
      name: personLabel(row.people),
      photoPath: row.people.photo_path,
    });
  }
  const roster = Array.from(players.values()).sort((a, b) => a.name.localeCompare(b.name, "en-GB"));

  const withPhotos = roster.filter((player) => player.photoPath);
  if (withPhotos.length > MAX_PHOTOS) {
    return new NextResponse(
      `That squad has ${withPhotos.length} photos; this export handles up to ${MAX_PHOTOS}.`,
      { status: 413 },
    );
  }

  const admin = createAdminClient();
  const downloads = await Promise.all(
    withPhotos.map(async (player) => {
      const path = player.photoPath!;
      const { data, error: downloadError } = await admin.storage.from("person-photos").download(path);
      if (downloadError || !data) return { player, bytes: null, path };
      return {
        player,
        bytes: new Uint8Array(await data.arrayBuffer()),
        path,
        contentType: data.type,
      };
    }),
  );

  // `<First Last>.<ext>`, and a second Tom Smith becomes `Tom Smith (2).jpg`
  // rather than overwriting the first — a zip may legally hold two entries of
  // the same name, and what a desktop does with that is anyone's guess.
  const used = new Map<string, number>();
  const entries: ZipEntry[] = [];
  const missing: string[] = [];

  for (const download of downloads) {
    if (!download.bytes) {
      missing.push(`${download.player.name} — the photo file could not be read`);
      continue;
    }
    const stem = zipSafeName(download.player.name);
    const seen = (used.get(stem.toLowerCase()) ?? 0) + 1;
    used.set(stem.toLowerCase(), seen);
    const suffix = seen === 1 ? "" : ` (${seen})`;
    entries.push({
      name: `${stem}${suffix}.${extensionFor(download.path, download.contentType)}`,
      data: download.bytes,
    });
  }

  for (const player of roster) {
    if (!player.photoPath) missing.push(`${player.name} — no photo on file`);
  }
  missing.sort((a, b) => a.localeCompare(b, "en-GB"));

  const note =
    missing.length === 0
      ? `Every player in ${team.name} has a photo.`
      : `${missing.length} of ${roster.length} players in ${team.name} have no photo in this archive:`;
  entries.push({
    name: "missing.txt",
    data: new TextEncoder().encode([note, ...missing].join("\r\n") + "\r\n"),
  });

  const zip = buildZip(entries);

  // The count, never the names: an audit row records that a squad's photos
  // left, not who is in the squad.
  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "team.photos.exported",
    entity: "teams",
    entityId: team.id,
    detail: { photos: entries.length - 1, missing: missing.length, players: roster.length },
  });

  const stem = zipSafeName(team.name).replace(/\s+/g, "-").toLowerCase() || "team";
  const ascii = `${stem}-photos.zip`.replace(/[^\x20-\x7e]/g, "-");
  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(`${stem}-photos.zip`)}`,
      "Cache-Control": "no-store",
    },
  });
}
