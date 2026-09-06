import { NextResponse } from "next/server";

import { getSessionProfile } from "@/lib/auth";
import { portalCsv, portalFileStem, type PortalRow } from "@/lib/clubs-portal";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { teamIdsFrom } from "../team-ids";

/**
 * The FA Clubs Portal spreadsheet for one or more teams (Adam, 2026-09-06).
 * `?team=<id>&team=<id>` — from the teams table's ticks, or one team from
 * the squad section of its own page.
 *
 * CLUB ADMINISTRATORS ONLY, asked twice: here through `is_club_admin()`, and
 * again inside `clubs_portal_export()`, which is what actually reads the
 * children's dates of birth and addresses and writes the audit row. The
 * route adds nothing to what the database decided — it only lays the rows
 * out as cells.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSessionProfile();
  if (!session) return new NextResponse("Sign in first.", { status: 401 });
  if (!(await isClubAdmin())) {
    return new NextResponse("The Clubs Portal export is for club administrators.", { status: 403 });
  }

  const teamIds = teamIdsFrom(request);
  if (teamIds.length === 0) return new NextResponse("Tick at least one team.", { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clubs_portal_export", { p_team_ids: teamIds });
  if (error) {
    const status = error.code === "42501" ? 403 : 500;
    return new NextResponse(`Could not export: ${error.message}`, { status });
  }

  const rows: PortalRow[] = (data ?? []).map((row) => ({
    team_name: row.team_name,
    first_name: row.first_name,
    last_name: row.last_name,
    dob: row.dob,
    sex: row.sex,
    email: row.email,
    phone: row.phone,
    age_proved: row.age_proved,
    address: row.address,
    contact1: row.contact1,
    contact2: row.contact2,
  }));
  rows.sort(
    (a, b) =>
      a.team_name.localeCompare(b.team_name, "en-GB") ||
      a.last_name.localeCompare(b.last_name, "en-GB") ||
      a.first_name.localeCompare(b.first_name, "en-GB"),
  );

  const teamNames = Array.from(new Set(rows.map((r) => r.team_name)));
  const stem = `${portalFileStem(teamNames)}-clubs-portal`;
  return new NextResponse(portalCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${stem}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
