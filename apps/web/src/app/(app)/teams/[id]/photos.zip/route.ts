import { NextResponse } from "next/server";

import { writeAudit } from "@/lib/audit";
import { getSessionProfile } from "@/lib/auth";
import { buildTeamPhotoEntries } from "@/lib/clubs-portal-photos";
import { isClubAdmin } from "@/lib/person";
import { buildZip, zipSafeName } from "@/lib/zip";

/**
 * Every live player's photo for one team, as a zip: a folder named for the
 * team, one file per player named after the player (Adam, 2026-08-25:
 * "export team contacts (players) photos to a zip file. The photos should be
 * named by the player name"). The archive is built by
 * `lib/clubs-portal-photos`, the same builder the multi-team export from the
 * teams table uses, so one team or five come out the same shape.
 *
 * CLUB ADMINISTRATORS ONLY. A squad's faces leaving the building in one file
 * is a different act from a coach seeing an avatar on the roster, so the gate
 * is `is_club_admin()` — the `person_roles` answer, asked through the caller's
 * own client — and nothing else. A committee sign-in that holds club_admin
 * passes on that, not on `profiles.role`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const result = await buildTeamPhotoEntries([id]);
  if (!result.ok) return new NextResponse(result.message, { status: result.status });
  const team = result.teams[0]!;

  const zip = buildZip(result.entries);

  // The count, never the names: an audit row records that a squad's photos
  // left, not who is in the squad.
  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "team.photos.exported",
    entity: "teams",
    entityId: team.id,
    detail: { photos: team.photos, missing: result.missing, players: team.players },
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
