"use server";

/**
 * The club-wide Full-Time widgets (fixtures + results).
 *
 * Full-Time's club widgets carry every team's fixtures (and, separately,
 * results) under one `lrcode` each. The two codes live in `site_settings`
 * (`fulltime_club_fixtures_code` / `fulltime_club_results_code`); the nightly
 * importer feeds every active team that has no per-team link from them,
 * matching widget names ("Ashton On Mersey FC U14 Mavericks") onto the club's
 * own team names ("U14 Mavericks") by suffix.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  fetchViaPgNet,
  matchClubTeam,
  normaliseTeamName,
  parseWidgetHtml,
  widgetCodeFrom,
  widgetUrl,
} from "@club/fulltime";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";


const FIXTURES_KEY = "fulltime_club_fixtures_code";
const RESULTS_KEY = "fulltime_club_results_code";

export type ClubWidgetPreview = {
  ok: boolean;
  message: string;
  code?: string;
  httpStatus?: number;
  /** How many fixtures the widget carries in total. */
  total?: number;
  /** Per configured team: how many of those fixtures are theirs. */
  matched?: Array<{ team: string; count: number }>;
  /** Widget names that look like this club's but match no configured team. */
  unmatchedOwn?: string[];
  warnings?: string[];
};

async function requireCommittee() {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) redirect("/room-bookings");
  return session;
}

/**
 * Fetch a pasted club widget and show which configured teams it would feed.
 */
export async function previewClubWidget(input: string): Promise<ClubWidgetPreview> {
  await requireCommittee();
  const code = widgetCodeFrom(input);
  if (!code) {
    return { ok: false, message: "No widget code found — paste the whole snippet or the number from var lrcode." };
  }
  const admin = createAdminClient();
  const url = widgetUrl(code);
  const res = await fetchViaPgNet(admin, url);
  if (res.classification !== "ok") {
    return {
      ok: false,
      code,
      httpStatus: res.status,
      message:
        res.classification === "challenge"
          ? "Full-Time answered with a Cloudflare challenge — try again in a few minutes. The code can still be saved."
          : res.error
            ? `Could not reach Full-Time: ${res.error}`
            : `Full-Time returned HTTP ${res.status}.`,
    };
  }
  const page = parseWidgetHtml(res.html);

  const { data: teamRows } = await admin.from("teams").select("name").eq("active", true);
  const names = ((teamRows ?? []) as Array<{ name: string }>).map((t) => t.name);

  const counts = new Map<string, number>();
  const prefixes = new Map<string, number>();
  const unmatchedNames = new Map<string, string>();
  for (const f of page.fixtures) {
    for (const side of [f.homeTeam, f.awayTeam]) {
      const team = matchClubTeam(side, names);
      if (team !== undefined) {
        counts.set(team, (counts.get(team) ?? 0) + 1);
        // What is left of the widget name once the team name is removed is the
        // club prefix — used below to spot our own unmatched teams.
        const full = normaliseTeamName(side);
        const short = normaliseTeamName(team);
        const prefix = full === short ? "" : full.slice(0, full.length - short.length - 1);
        if (prefix !== "") prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
      } else {
        unmatchedNames.set(normaliseTeamName(side), side);
      }
    }
  }
  const clubPrefix = [...prefixes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const unmatchedOwn = clubPrefix
    ? [...unmatchedNames.entries()]
        .filter(([key]) => key.startsWith(`${clubPrefix} `))
        .map(([, name]) => name)
        .sort()
    : [];

  const matched = [...counts.entries()]
    .map(([team, count]) => ({ team, count }))
    .sort((a, b) => a.team.localeCompare(b.team));

  return {
    ok: true,
    code,
    httpStatus: res.status,
    total: page.fixtures.length,
    matched,
    unmatchedOwn,
    warnings: page.warnings.slice(0, 10),
    message:
      page.fixtures.length === 0
        ? "The widget returned no fixtures — it may be the results widget before any matches have been played. It can still be saved."
        : matched.length === 0
          ? "No fixtures matched any configured team — check the team names."
          : "",
  };
}

/** Save (or clear) the two club widget codes. Empty input clears a code. */
export async function saveClubWidgetCodes(input: {
  fixtures: string;
  results: string;
}): Promise<{ error?: string }> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  const entries: Array<{ key: string; label: string; raw: string }> = [
    { key: FIXTURES_KEY, label: "fixtures", raw: input.fixtures },
    { key: RESULTS_KEY, label: "results", raw: input.results },
  ];
  const detail: Record<string, string | null> = {};
  for (const { key, label, raw } of entries) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      const { error } = await admin.from("site_settings").delete().eq("key", key);
      if (error) return { error: `Could not clear the ${label} code: ${error.message}` };
      detail[key] = null;
      continue;
    }
    const code = widgetCodeFrom(trimmed);
    if (!code) return { error: `No widget code found in the ${label} snippet.` };
    const { error } = await admin
      .from("site_settings")
      .upsert({ key, value: code, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return { error: `Could not save the ${label} code: ${error.message}` };
    detail[key] = code;
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "club_widgets",
    entity: "site_settings",
    entityId: FIXTURES_KEY,
    detail,
  });
  revalidatePath("/teams");
  return {};
}

export type ClubRunResult = { ok: boolean; status?: number; body?: string; message?: string };

/** Run the importer now for every team (per-team links and the club feed). */
export async function runClubImport(): Promise<ClubRunResult> {
  await requireCommittee();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return { ok: false, message: "Supabase is not configured on this server." };
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/functions/v1/fulltime-import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
      body: "{}",
    });
    const text = await response.text();
    let body = text;
    try {
      body = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* keep raw */
    }
    revalidatePath("/teams");
    return { ok: response.ok, status: response.status, body };
  } catch (cause) {
    return { ok: false, message: `Could not reach the importer: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}
