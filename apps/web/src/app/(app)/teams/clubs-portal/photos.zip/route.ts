import { NextResponse } from "next/server";

import { writeAudit } from "@/lib/audit";
import { getSessionProfile } from "@/lib/auth";
import { buildTeamPhotoEntries } from "@/lib/clubs-portal-photos";
import { portalFileStem } from "@/lib/clubs-portal";
import { isClubAdmin } from "@/lib/person";
import { buildZip } from "@/lib/zip";

import { teamIdsFrom } from "../team-ids";

/**
 * Squad photos for several teams at once, from the teams table's ticks
 * (Adam, 2026-09-06: "the admin also needs the ability to export team photos
 * in exactly the same way … folder for the team, then the photo filename
 * should be the player's name"). `?team=<id>&team=<id>`.
 *
 * Club administrators only — the same gate as the single-team route, for the
 * same reason. One audit row per export, counting.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSessionProfile();
  if (!session) return new NextResponse("Sign in first.", { status: 401 });
  if (!(await isClubAdmin())) {
    return new NextResponse("The squad photo export is for club administrators.", { status: 403 });
  }

  const teamIds = teamIdsFrom(request);
  if (teamIds.length === 0) return new NextResponse("Tick at least one team.", { status: 400 });

  const result = await buildTeamPhotoEntries(teamIds);
  if (!result.ok) return new NextResponse(result.message, { status: result.status });

  const zip = buildZip(result.entries);

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "teams.clubs_portal.photos_exported",
    entity: "teams",
    entityId: result.teams.map((t) => t.id).join(","),
    detail: {
      teams: result.teams.length,
      photos: result.teams.reduce((n, t) => n + t.photos, 0),
      players: result.teams.reduce((n, t) => n + t.players, 0),
      missing: result.missing,
    },
  });

  const stem = `${portalFileStem(result.teams.map((t) => t.name))}-photos`;
  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
      "Content-Disposition": `attachment; filename="${stem}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
