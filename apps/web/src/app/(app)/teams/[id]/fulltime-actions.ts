"use server";

/**
 * The team ↔ FA Full-Time link (PLAN.md P2.3; widget import 2026-08-24).
 *
 * Everything Full-Time-shaped lives in `@club/fulltime` and everything in this
 * file runs on the server: the parser and the club's Full-Time identifiers
 * never reach the browser bundle.
 *
 * What the admin pastes is the team's Full-Time **widget snippet** (the
 * "add to your website" code, whose `lrcode` names the team's fixtures-and-
 * results feed), a bare code, or the widget URL. A league/division page URL
 * is still accepted as the older, weaker form of link. Either way the fetch
 * is made by Postgres through pg_net — Cloudflare refuses this server's own
 * HTTP client — via `fetchViaPgNet`.
 *
 * The flow is paste → parse → test-fetch → preview → save: `previewFullTimeLink`
 * does the first four and returns something a human can confirm,
 * `saveFullTimeLink` writes the row. Re-linking is an upsert on the primary
 * key, so a new season or a league change updates the link and leaves the
 * team's `fixtures` (keyed by `external_ref`) untouched.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  buildFixturesUrl,
  fetchViaPgNet,
  fixturesForTeam,
  FullTimeUrlError,
  parseFixturesPage,
  parseFullTimeUrl,
  matchClubTeam,
  parseWidgetHtml,
  RateLimiter,
  teamNamesIn,
  widgetCodeFrom,
  widgetTeamName,
  widgetUrl,
  type FullTimeIds,
  type FullTimeResponse,
  type ParsedPage,
} from "@club/fulltime";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { formatBookingDateShort } from "@/lib/booking-time";

/** Preview tables are for confirmation, not for reading a whole season. */
const PREVIEW_LIMIT = 30;

/**
 * One process-wide limiter. Full-Time challenges after a handful of quick
 * requests, and an admin clicking "Preview" twice is exactly that.
 */
const limiter = new RateLimiter();

const CHALLENGE_MESSAGE =
  "Full-Time answered with a Cloudflare challenge instead of the fixtures. Save the link anyway and try again later (the nightly import keeps trying), or paste the fixtures into the manual import.";

export type PreviewRow = {
  externalRef: string;
  /** Europe/London kick-off, already formatted for display. */
  dateLabel: string;
  timeLabel: string;
  isHome: boolean;
  opponent: string;
  competition: string;
  status: string;
  /** `3–1` once played, otherwise empty. */
  score: string;
  venue: string;
};

export type PreviewSeason = { id: string; name: string; selected: boolean };

export type PreviewOutcome = "invalid_url" | "ok" | "challenge" | "not_found" | "error";

export type PreviewResult = {
  outcome: PreviewOutcome;
  /** Always safe to show to the admin; empty when there is nothing to add. */
  message: string;
  /** `widget` when the paste carried an lrcode; `page` for a Full-Time page URL. */
  source?: "widget" | "page";
  /** The widget code, when `source` is `widget`. */
  widgetCode?: string;
  /** Present whenever a page URL parsed, even if the fetch was blocked. */
  ids?: FullTimeIds;
  /** The URL that was requested. */
  fetchedUrl?: string;
  httpStatus?: number;
  /** The name the fixtures were matched against. */
  ftTeamName?: string;
  /** The team the widget itself appears to belong to (in every fixture). */
  detectedTeamName?: string;
  rows?: PreviewRow[];
  /** How many fixtures matched in total, before the preview limit. */
  matchedCount?: number;
  /** The `selectedSeason` options Full-Time offered on the page. */
  seasons?: PreviewSeason[];
  /** Every team name the parser saw, so the admin can pick the right one. */
  teamNames?: string[];
  /** Rows the parser recognised but could not read — the breakage signal. */
  warnings?: string[];
};

export type SaveFullTimeLinkInput = {
  /** What the admin pasted: widget snippet, code, widget URL or page URL. */
  input: string;
  /** Page-URL links only: identifiers the preview resolved. */
  ids?: FullTimeIds;
  ftTeamName: string;
  enabled: boolean;
};

async function requireCommittee() {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) redirect("/room-bookings");
  return session;
}

/**
 * The default Full-Time team name: the club's name as Full-Time prints it
 * (site_settings `fulltime_club_name`), then the team's own name —
 * "Ashton On Mersey FC U14 Mavericks".
 */
async function defaultFtTeamName(
  admin: ReturnType<typeof createAdminClient>,
  teamName: string,
): Promise<string> {
  const { data } = await admin
    .from("site_settings")
    .select("value")
    .eq("key", "fulltime_club_name")
    .maybeSingle();
  const clubName = (data?.value ?? "").trim() || "Ashton On Mersey FC";
  return `${clubName} ${teamName}`.trim();
}

function revalidateTeam(teamId: string) {
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/teams");
}

/**
 * The identifiers a page-URL link needs, taken from the pasted URL and topped
 * up from whatever the preview resolved (Full-Time omits `selectedSeason` from
 * plenty of perfectly good links).
 */
function mergeIds(fromUrl: FullTimeIds, fromPreview: FullTimeIds | undefined): FullTimeIds {
  if (!fromPreview) return fromUrl;
  const merged: FullTimeIds = { ...fromUrl };
  if (!merged.leagueId) merged.leagueId = fromPreview.leagueId;
  if (!merged.seasonId && fromPreview.seasonId) merged.seasonId = fromPreview.seasonId;
  if (!merged.divisionId && fromPreview.divisionId) merged.divisionId = fromPreview.divisionId;
  if (!merged.competitionId && fromPreview.competitionId) merged.competitionId = fromPreview.competitionId;
  if (!merged.fixtureGroupKey && fromPreview.fixtureGroupKey) {
    merged.fixtureGroupKey = fromPreview.fixtureGroupKey;
  }
  if (!merged.teamId && fromPreview.teamId) merged.teamId = fromPreview.teamId;
  return merged;
}

/** The `divisionseason` the snippet's "click here for …" link points at, if any. */
function divisionFromSnippet(input: string): string | undefined {
  return /divisionseason=(\d+)/i.exec(input)?.[1];
}

/** A fetch outcome the admin can act on, or `undefined` when the body is usable. */
function failedPreview(
  response: FullTimeResponse,
  extra: Partial<PreviewResult>,
): PreviewResult | undefined {
  const base = { ...extra, fetchedUrl: response.url, httpStatus: response.status };
  switch (response.classification) {
    case "ok":
      return undefined;
    case "challenge":
      return { outcome: "challenge", message: CHALLENGE_MESSAGE, ...base };
    case "not_found":
      return {
        outcome: "not_found",
        message: `Full-Time returned HTTP ${response.status} for that address — check it and try again.`,
        ...base,
      };
    default:
      return {
        outcome: "error",
        message: response.error
          ? `Could not reach Full-Time: ${response.error}`
          : `Full-Time returned HTTP ${response.status}.`,
        ...base,
      };
  }
}

function previewRows(parsed: ParsedPage, ftTeamName: string): Pick<PreviewResult, "rows" | "matchedCount"> {
  const matched = fixturesForTeam(parsed, ftTeamName);
  const rows: PreviewRow[] = matched.slice(0, PREVIEW_LIMIT).map((fixture) => ({
    externalRef: fixture.externalRef,
    dateLabel: formatBookingDateShort(fixture.date),
    timeLabel: fixture.time ?? "—",
    isHome: fixture.isHome,
    opponent: fixture.opponent,
    competition: fixture.competition ?? "—",
    status: fixture.status,
    score:
      fixture.homeScore !== undefined && fixture.awayScore !== undefined
        ? `${fixture.homeScore}–${fixture.awayScore}`
        : "",
    venue: fixture.venue ?? "",
  }));
  return { rows, matchedCount: matched.length };
}

/**
 * Read what the admin pasted, fetch the feed it names, and return what one
 * team's fixtures would look like.
 *
 * Never throws for anything the admin can fix: a bad paste, a Cloudflare
 * challenge and a 404 are all outcomes, not exceptions.
 */
export async function previewFullTimeLink(
  teamId: string,
  input: string,
  ftTeamNameOverride?: string,
): Promise<PreviewResult> {
  await requireCommittee();
  const admin = createAdminClient();

  const { data: team } = await admin.from("teams").select("id,name").eq("id", teamId).maybeSingle();
  if (!team) return { outcome: "error", message: "That team no longer exists." };

  // --- Widget: the import source --------------------------------------------
  const widgetCode = widgetCodeFrom(input);
  if (widgetCode) {
    const fetchedUrl = widgetUrl(widgetCode);
    await limiter.wait();
    const response = await fetchViaPgNet(admin, fetchedUrl);
    const failed = failedPreview(response, { source: "widget", widgetCode });
    if (failed) return failed;

    const parsed = parseWidgetHtml(response.html);
    // The expected name decides which side is ours; the name the widget itself
    // proves is only adopted when it corroborates the expected one — a wrongly
    // pasted widget must not preview (or import) another club's season.
    const detected = widgetTeamName(parsed.fixtures);
    const wanted = (ftTeamNameOverride ?? "").trim() || (await defaultFtTeamName(admin, team.name));
    let ftTeamName = wanted;
    let { rows, matchedCount } = previewRows(parsed, ftTeamName);
    if (matchedCount === 0 && detected && matchClubTeam(detected, [wanted, team.name])) {
      ftTeamName = detected;
      ({ rows, matchedCount } = previewRows(parsed, ftTeamName));
    }
    const wrongWidget =
      parsed.fixtures.length > 0 && matchedCount === 0 && detected !== undefined;
    return {
      outcome: "ok",
      message:
        parsed.fixtures.length === 0
          ? "The widget returned no fixtures — Full-Time may not have published this season's yet. The link can still be saved; the nightly import will pick them up when they appear."
          : wrongWidget
            ? `This widget appears to belong to "${detected}", not "${ftTeamName}" — it looks like the wrong team's snippet. Nothing would be imported.`
            : matchedCount === 0
              ? "No fixtures in the widget involve this team — check the team name matches Full-Time's."
              : "",
      source: "widget",
      widgetCode,
      fetchedUrl,
      httpStatus: response.status,
      ftTeamName,
      detectedTeamName: detected,
      rows,
      matchedCount,
      teamNames: matchedCount === 0 ? teamNamesIn(parsed.fixtures) : [],
      warnings: parsed.warnings.slice(0, 10),
    };
  }

  // --- Page URL: the older form of link -------------------------------------
  let ids: FullTimeIds;
  try {
    ids = parseFullTimeUrl(input);
  } catch (cause) {
    return {
      outcome: "invalid_url",
      message:
        cause instanceof FullTimeUrlError
          ? `${cause.message} Paste the team's Full-Time widget snippet (Full-Time → the team → "Add to your website") or a Full-Time page address.`
          : "That does not look like a Full-Time widget snippet or address.",
    };
  }

  if (!ids.leagueId) {
    return {
      outcome: "invalid_url",
      message:
        "That Full-Time link has a team but no league in it — paste the team's widget snippet instead, or the league/division fixtures page address.",
      ids,
    };
  }

  const fetchedUrl = buildFixturesUrl(ids);
  await limiter.wait();
  const response = await fetchViaPgNet(admin, fetchedUrl);
  const failed = failedPreview(response, { source: "page", ids });
  if (failed) return failed;

  const parsed = parseFixturesPage(response.html);
  const ftTeamName = (ftTeamNameOverride ?? "").trim() || team.name;
  const { rows, matchedCount } = previewRows(parsed, ftTeamName);

  // The page's own season options, so the admin can see which `selectedSeason`
  // the link will store and whether it is the one they meant.
  const seasons: PreviewSeason[] = parsed.seasons.map((s) => ({
    id: s.id,
    name: s.name,
    selected: s.selected,
  }));
  const pageSeason = parsed.seasons.find((s) => s.selected);
  const resolvedIds: FullTimeIds =
    ids.seasonId || !pageSeason ? ids : { ...ids, seasonId: pageSeason.id };

  return {
    outcome: "ok",
    message:
      matchedCount === 0
        ? "No fixtures found for this team — check the team name matches Full-Time's."
        : "",
    source: "page",
    ids: resolvedIds,
    fetchedUrl,
    httpStatus: response.status,
    ftTeamName,
    rows,
    matchedCount,
    seasons,
    teamNames: teamNamesIn(parsed.fixtures),
    warnings: parsed.warnings.slice(0, 10),
  };
}

/**
 * Create or re-point a team's Full-Time link.
 *
 * An upsert on the primary key, so re-linking a team for a new season or a new
 * league updates the row in place and orphans nothing: `fixtures` are keyed by
 * `(team_id, external_ref)` and are never touched here.
 */
export async function saveFullTimeLink(
  teamId: string,
  input: SaveFullTimeLinkInput,
): Promise<{ error?: string }> {
  const session = await requireCommittee();
  const admin = createAdminClient();
  // A blank name still stores the full default — "Ashton On Mersey FC U14
  // Mavericks" — because the importer matches on it and a bare team name
  // matches nothing in a widget.
  const { data: team } = await admin.from("teams").select("name").eq("id", teamId).maybeSingle();
  const ftTeamName =
    input.ftTeamName.trim() || (team ? await defaultFtTeamName(admin, team.name) : null);

  // The paste is re-read server side; nothing the browser sent back is trusted
  // beyond filling in blanks a page URL did not carry.
  const widgetCode = widgetCodeFrom(input.input);
  let row;
  if (widgetCode) {
    row = {
      team_id: teamId,
      source_url: widgetUrl(widgetCode),
      widget_code: widgetCode,
      league_id: null,
      ft_season_id: null,
      division_id: divisionFromSnippet(input.input) ?? null,
      fixture_group_key: null,
      ft_team_id: null,
      ft_team_name: ftTeamName,
      enabled: input.enabled,
      updated_by: session.userId,
    };
  } else {
    let fromUrl: FullTimeIds;
    try {
      fromUrl = parseFullTimeUrl(input.input);
    } catch (cause) {
      return {
        error:
          cause instanceof FullTimeUrlError
            ? cause.message
            : "That does not look like a Full-Time widget snippet or address.",
      };
    }
    const ids = mergeIds(fromUrl, input.ids);
    if (!ids.leagueId) {
      return {
        error:
          "That Full-Time link has no league in it — paste the team's widget snippet, or the league/division fixtures page address.",
      };
    }
    if (!ids.seasonId) {
      return {
        error:
          "That Full-Time link has no season in it — open the division's fixtures page for the season you want and copy that address, or run a preview first so the season can be read off the page.",
      };
    }
    row = {
      team_id: teamId,
      source_url: buildFixturesUrl(ids),
      widget_code: null,
      league_id: ids.leagueId,
      ft_season_id: ids.seasonId,
      division_id: ids.divisionId ?? null,
      fixture_group_key: ids.fixtureGroupKey ?? null,
      ft_team_id: ids.teamId ?? null,
      ft_team_name: ftTeamName,
      enabled: input.enabled,
      updated_by: session.userId,
    };
  }

  const { error } = await admin.from("team_fulltime_links").upsert(row, { onConflict: "team_id" });
  if (error) return { error: `Could not save the Full-Time link: ${error.message}` };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "link",
    entity: "team_fulltime_link",
    entityId: teamId,
    detail: {
      source_url: row.source_url,
      widget_code: row.widget_code,
      league_id: row.league_id,
      ft_season_id: row.ft_season_id,
      division_id: row.division_id,
      ft_team_name: ftTeamName,
      enabled: input.enabled,
    },
  });

  revalidateTeam(teamId);
  return {};
}

/** Pause or resume the importer for one team without losing the identifiers. */
export async function setFullTimeLinkEnabled(
  teamId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  const { error } = await admin
    .from("team_fulltime_links")
    .update({ enabled, updated_by: session.userId })
    .eq("team_id", teamId);
  if (error) return { error: `Could not update the Full-Time link: ${error.message}` };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: enabled ? "enable" : "disable",
    entity: "team_fulltime_link",
    entityId: teamId,
    detail: { enabled },
  });

  revalidateTeam(teamId);
  return {};
}

/** Remove the link. Fixtures already imported are deliberately left alone. */
export async function removeFullTimeLink(teamId: string): Promise<{ error?: string }> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  const { error } = await admin.from("team_fulltime_links").delete().eq("team_id", teamId);
  if (error) return { error: `Could not remove the Full-Time link: ${error.message}` };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "unlink",
    entity: "team_fulltime_link",
    entityId: teamId,
    detail: {},
  });

  revalidateTeam(teamId);
  return {};
}
