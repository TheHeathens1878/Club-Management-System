"use server";

/**
 * The club-wide Full-Time widgets (fixtures + results).
 *
 * Full-Time's club widgets carry every team's fixtures (and, separately,
 * results) under one `lrcode` each. The two codes live in `site_settings`
 * (`fulltime_club_fixtures_code` / `fulltime_club_results_code`, each able to
 * hold several codes — the girls' league has its own club widget); the
 * nightly importer feeds every active team that has no per-team link from
 * them. Matching is anchored on the club's Full-Time name (site_settings
 * `fulltime_club_name`): "Ashton On Mersey FC U14 Mavericks" → "U14
 * Mavericks", "Ashton On Mersey FC U8 Sparrows Orange" → "U08 Sparrows
 * Girls" — never a name with another club's prefix.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  fetchViaPgNet,
  foldTeamName,
  matchClubTeam,
  parseWidgetHtml,
  widgetCodesFrom,
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

/** The club's name as Full-Time prints it — anchors all club-feed matching. */
async function clubName(admin: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data } = await admin
    .from("site_settings")
    .select("value")
    .eq("key", "fulltime_club_name")
    .maybeSingle();
  return (data?.value ?? "").trim() || "Ashton On Mersey FC";
}

/**
 * Fetch the widget(s) in a paste — several snippets are fine — and show which
 * configured teams they would feed.
 */
export async function previewClubWidget(input: string): Promise<ClubWidgetPreview> {
  await requireCommittee();
  const codes = widgetCodesFrom(input);
  if (codes.length === 0) {
    return { ok: false, message: "No widget code found — paste the whole snippet or the number from var lrcode." };
  }
  const admin = createAdminClient();
  const prefix = await clubName(admin);

  const { data: teamRows } = await admin.from("teams").select("name").eq("active", true);
  const names = ((teamRows ?? []) as Array<{ name: string }>).map((t) => t.name);

  const counts = new Map<string, number>();
  const unmatchedOwnSet = new Map<string, string>();
  const warnings: string[] = [];
  let total = 0;
  const foldedPrefix = foldTeamName(prefix);

  for (const code of codes) {
    const url = widgetUrl(code);
    const res = await fetchViaPgNet(admin, url);
    if (res.classification !== "ok") {
      warnings.push(
        res.classification === "challenge"
          ? `Code ${code}: Cloudflare challenge — try again in a few minutes. It can still be saved.`
          : `Code ${code}: ${res.error ?? `HTTP ${res.status}`}.`,
      );
      continue;
    }
    const page = parseWidgetHtml(res.html);
    total += page.fixtures.length;
    warnings.push(...page.warnings.slice(0, 5));
    for (const f of page.fixtures) {
      for (const side of [f.homeTeam, f.awayTeam]) {
        const team = matchClubTeam(side, names, prefix);
        if (team !== undefined) {
          counts.set(team, (counts.get(team) ?? 0) + 1);
        } else if (foldTeamName(side).startsWith(`${foldedPrefix} `)) {
          // One of ours by name, but no configured team claims it.
          unmatchedOwnSet.set(foldTeamName(side), side);
        }
      }
    }
  }

  const matched = [...counts.entries()]
    .map(([team, count]) => ({ team, count }))
    .sort((a, b) => a.team.localeCompare(b.team));
  const unmatchedOwn = [...unmatchedOwnSet.values()].sort();

  return {
    ok: true,
    code: codes.join(", "),
    total,
    matched,
    unmatchedOwn,
    warnings: warnings.slice(0, 10),
    message:
      total === 0
        ? "The widget returned no fixtures — it may be the results widget before any matches have been played. It can still be saved."
        : matched.length === 0
          ? `No fixtures matched any configured team — matching expects names like "${prefix} U14 Mavericks".`
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
    const codes = widgetCodesFrom(trimmed);
    if (codes.length === 0) return { error: `No widget code found in the ${label} snippet.` };
    const value = codes.join(" ");
    const { error } = await admin
      .from("site_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return { error: `Could not save the ${label} code: ${error.message}` };
    detail[key] = value;
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
