"use client";

/**
 * The admin's Full-Time link panel: paste the team's Full-Time widget snippet
 * (or a page address), test-fetch it, confirm the fixtures the parser read,
 * then save.
 *
 * No Full-Time knowledge lives in here — the URL goes to a server action and
 * what comes back is already parsed, classified and formatted. That keeps the
 * parser and the cross-origin fetch out of the browser bundle entirely.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Link2Off,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import {
  previewFullTimeLink,
  removeFullTimeLink,
  saveFullTimeLink,
  setFullTimeLinkEnabled,
  type PreviewResult,
} from "./fulltime-actions";
import { triggerScheduledImport, type EdgeFunctionResult } from "./import-actions";

export type FullTimeLinkView = {
  source_url: string;
  widget_code: string | null;
  league_id: string | null;
  ft_season_id: string | null;
  division_id: string | null;
  fixture_group_key: string | null;
  ft_team_id: string | null;
  ft_team_name: string | null;
  enabled: boolean;
  last_import_at: string | null;
  last_import_status: string | null;
  last_import_count: number | null;
  last_error: string | null;
};

export type ClubSeasonView = { id: string; name: string; is_current: boolean };

function stamp(iso: string | null): string {
  if (!iso) return "never";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "never";
  return at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function importBadge(status: string | null) {
  if (status === "ok") return <Badge variant="success">Last import OK</Badge>;
  if (status === "challenge") return <Badge variant="warning">Blocked by Cloudflare</Badge>;
  if (status === "error") return <Badge variant="destructive">Last import failed</Badge>;
  return <Badge variant="muted">Not imported yet</Badge>;
}

export function FullTimePanel({
  teamId,
  teamName,
  defaultFtName,
  link,
  clubSeasons,
}: {
  teamId: string;
  teamName: string;
  /** "Ashton On Mersey FC <team>" — how Full-Time prints this team. */
  defaultFtName: string;
  link: FullTimeLinkView | null;
  clubSeasons: ClubSeasonView[];
}) {
  const router = useRouter();
  const [input, setInput] = useState(link?.widget_code ?? link?.source_url ?? "");
  const [ftTeamName, setFtTeamName] = useState(link?.ft_team_name ?? defaultFtName);
  const [enabled, setEnabled] = useState(link?.enabled ?? true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "save" | "remove" | "toggle" | "import">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [importResult, setImportResult] = useState<EdgeFunctionResult | null>(null);

  const canSave =
    preview !== null &&
    preview.outcome !== "invalid_url" &&
    (preview.source === "widget" || preview.ids !== undefined);

  async function runPreview() {
    setError(null);
    setSaved(false);
    setImportResult(null);
    setBusy("preview");
    const result = await previewFullTimeLink(teamId, input, ftTeamName);
    setBusy(null);
    setPreview(result);
    // The widget proves the team's name; take it rather than make the admin type it.
    if (result.source === "widget" && result.ftTeamName) setFtTeamName(result.ftTeamName);
  }

  async function runSave() {
    if (!canSave) return;
    setError(null);
    setBusy("save");
    const result = await saveFullTimeLink(teamId, {
      input,
      ...(preview?.ids ? { ids: preview.ids } : {}),
      ftTeamName,
      enabled,
    });
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function runImportNow() {
    setError(null);
    setImportResult(null);
    setBusy("import");
    const result = await triggerScheduledImport(teamId);
    setBusy(null);
    setImportResult(result);
    router.refresh();
  }

  async function runToggle() {
    setError(null);
    setBusy("toggle");
    const next = !enabled;
    const result = await setFullTimeLinkEnabled(teamId, next);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setEnabled(next);
    router.refresh();
  }

  async function runRemove() {
    if (!confirm(`Remove the Full-Time link for "${teamName}"?\n\nFixtures already imported are kept.`)) {
      return;
    }
    setError(null);
    setBusy("remove");
    const result = await removeFullTimeLink(teamId);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPreview(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------------ */}
      {/* The link as it stands                                              */}
      {/* ------------------------------------------------------------------ */}
      {link ? (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={link.enabled ? "default" : "muted"}>
              {link.enabled ? "Import enabled" : "Import paused"}
            </Badge>
            {importBadge(link.last_import_status)}
            <span className="text-xs text-muted-foreground">
              Last import {stamp(link.last_import_at)}
              {typeof link.last_import_count === "number" && ` · ${link.last_import_count} fixtures`}
            </span>
          </div>
          <p className="break-all font-mono text-[11px] text-muted-foreground">{link.source_url}</p>
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            {link.widget_code ? (
              <>
                <div>
                  <dt className="inline text-muted-foreground">Widget code: </dt>
                  <dd className="inline font-mono">{link.widget_code}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Division: </dt>
                  <dd className="inline font-mono">{link.division_id ?? "—"}</dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt className="inline text-muted-foreground">League: </dt>
                  <dd className="inline font-mono">{link.league_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Full-Time season: </dt>
                  <dd className="inline font-mono">{link.ft_season_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Division: </dt>
                  <dd className="inline font-mono">{link.division_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Fixture group: </dt>
                  <dd className="inline font-mono">{link.fixture_group_key ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Full-Time team id: </dt>
                  <dd className="inline font-mono">{link.ft_team_id ?? "—"}</dd>
                </div>
              </>
            )}
            <div>
              <dt className="inline text-muted-foreground">Full-Time team name: </dt>
              <dd className="inline">{link.ft_team_name ?? teamName}</dd>
            </div>
          </dl>
          {!link.widget_code && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                This link uses a Full-Time page address. Paste the team&apos;s widget snippet below to switch
                to the widget feed, which also carries results.
              </span>
            </p>
          )}
          {link.last_error && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{link.last_error}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={runImportNow} disabled={busy !== null}>
              {busy === "import" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Import now
            </Button>
            <Button size="sm" variant="outline" onClick={runToggle} disabled={busy !== null}>
              {busy === "toggle" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {enabled ? "Pause importing" : "Resume importing"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={runRemove}
              disabled={busy !== null}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              {busy === "remove" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2Off className="h-3.5 w-3.5" />
              )}
              Remove link
            </Button>
          </div>
          {importResult && (
            <div
              className={
                "rounded-md border px-3 py-2 text-xs " +
                (importResult.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-destructive/40 bg-destructive/5 text-destructive")
              }
            >
              <p className="font-medium">
                {importResult.ok ? "Import ran." : importResult.message ?? "Import failed."}
                {importResult.status ? ` HTTP ${importResult.status}` : ""}
              </p>
              {importResult.body && (
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">
                  {importResult.body}
                </pre>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
          This team is not linked to Full-Time yet. Paste the team&apos;s Full-Time widget snippet below and
          run a preview.
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Paste + preview                                                    */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ft-input">Full-Time widget snippet</Label>
          <textarea
            id="ft-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={'<div id="lrep728576966">…</div>\n<script>var lrcode = \'728576966\'</script>\n<script src="https://fulltime.thefa.com/client/api/cs1.js"></script>'}
            className="w-full break-all rounded-md border border-input bg-card px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            On fulltime.thefa.com open the team&apos;s league, pick the team and choose{" "}
            <span className="font-medium">Add to your website</span> (the &ldquo;team fixtures&rdquo; widget).
            Paste the whole snippet, or just the number from <span className="font-mono">var lrcode</span>.
            The widget carries the team&apos;s fixtures and results for the season. A Full-Time page address
            still works as a fallback.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ft-team-name">Team name on Full-Time</Label>
          <Input
            id="ft-team-name"
            value={ftTeamName}
            onChange={(e) => setFtTeamName(e.target.value)}
            placeholder={defaultFtName}
          />
          <p className="text-xs text-muted-foreground">
            Read from the widget automatically when you preview. Only needed by hand for a page address,
            where it must match Full-Time exactly — the preview lists every name it saw.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Import fixtures and results for this team automatically (nightly)
        </label>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={runPreview} disabled={busy !== null || !input.trim()}>
            {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Test &amp; preview
          </Button>
          <Button size="sm" onClick={runSave} disabled={busy !== null || !canSave}>
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {preview && preview.outcome !== "ok" ? "Save link anyway" : "Save link"}
          </Button>
        </div>
        {!canSave && preview === null && (
          <p className="text-xs text-muted-foreground">Run a preview before saving.</p>
        )}
        {error && (
          <p className="flex items-start gap-1.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        {saved && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Full-Time link saved. Use <span className="font-medium">Import now</span>{" "}
            above to fetch the fixtures straight away, or leave it to the nightly import.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Preview result                                                     */}
      {/* ------------------------------------------------------------------ */}
      {preview && <PreviewBlock preview={preview} clubSeasons={clubSeasons} onPickTeam={setFtTeamName} />}
    </div>
  );
}

function PreviewBlock({
  preview,
  clubSeasons,
  onPickTeam,
}: {
  preview: PreviewResult;
  clubSeasons: ClubSeasonView[];
  onPickTeam: (name: string) => void;
}) {
  const rows = preview.rows ?? [];
  const teamNames = preview.teamNames ?? [];
  const seasons = preview.seasons ?? [];
  const warnings = preview.warnings ?? [];

  return (
    <div className="space-y-4 rounded-lg border p-4">
      {preview.outcome === "invalid_url" && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{preview.message}</span>
        </p>
      )}

      {preview.outcome === "challenge" && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {preview.message}
            {preview.source === "widget" || preview.ids?.seasonId ? " The link can still be saved." : ""}
          </span>
        </p>
      )}

      {(preview.outcome === "not_found" || preview.outcome === "error") && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{preview.message}</span>
        </p>
      )}

      {preview.outcome === "ok" && rows.length === 0 && (
        <p className="flex items-start gap-2 text-sm text-amber-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{preview.message}</span>
        </p>
      )}

      {preview.fetchedUrl && (
        <p className="break-all font-mono text-[11px] text-muted-foreground">
          Fetched {preview.fetchedUrl}
          {preview.httpStatus ? ` · HTTP ${preview.httpStatus}` : ""}
        </p>
      )}

      {preview.source === "widget" && preview.widgetCode && (
        <p className="text-xs text-muted-foreground">
          Widget code <span className="font-mono">{preview.widgetCode}</span>
          {preview.ftTeamName ? (
            <>
              {" "}· matched as <span className="font-medium">{preview.ftTeamName}</span>
            </>
          ) : null}
        </p>
      )}

      {preview.detectedTeamName &&
        preview.ftTeamName &&
        preview.detectedTeamName !== preview.ftTeamName && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This widget belongs to <span className="font-medium">{preview.detectedTeamName}</span> — only
              fixtures involving <span className="font-medium">{preview.ftTeamName}</span> would import.
            </span>
          </p>
        )}

      {preview.ids && (
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <div>
            <dt className="inline text-muted-foreground">League: </dt>
            <dd className="inline font-mono">{preview.ids.leagueId || "—"}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Season: </dt>
            <dd className="inline font-mono">{preview.ids.seasonId ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Division: </dt>
            <dd className="inline font-mono">{preview.ids.divisionId ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Competition: </dt>
            <dd className="inline font-mono">{preview.ids.competitionId ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Fixture group: </dt>
            <dd className="inline font-mono">{preview.ids.fixtureGroupKey ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Full-Time team id: </dt>
            <dd className="inline font-mono">{preview.ids.teamId ?? "—"}</dd>
          </div>
        </dl>
      )}

      {rows.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">
            {preview.matchedCount} fixture{preview.matchedCount === 1 ? "" : "s"} for{" "}
            <span className="font-semibold">{preview.ftTeamName}</span>
            {(preview.matchedCount ?? 0) > rows.length && ` — showing the first ${rows.length}`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Date</th>
                  <th className="py-1.5 pr-3 font-medium">Time</th>
                  <th className="py-1.5 pr-3 font-medium">H/A</th>
                  <th className="py-1.5 pr-3 font-medium">Opponent</th>
                  <th className="py-1.5 pr-3 font-medium">Venue</th>
                  <th className="py-1.5 pr-3 font-medium">Score</th>
                  <th className="py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.externalRef} className="border-b last:border-0">
                    <td className="whitespace-nowrap py-1.5 pr-3">{row.dateLabel}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3">{row.timeLabel}</td>
                    <td className="py-1.5 pr-3">{row.isHome ? "Home" : "Away"}</td>
                    <td className="py-1.5 pr-3">{row.opponent}</td>
                    <td className="py-1.5 pr-3">{row.venue || "—"}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3">{row.score || "—"}</td>
                    <td className="py-1.5 capitalize">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Times are Europe/London, as Full-Time prints them.
          </p>
        </div>
      )}

      {teamNames.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            Team names on that page — click one to use it
          </p>
          <div className="flex flex-wrap gap-1.5">
            {teamNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onPickTeam(name)}
                className="rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-secondary"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {seasons.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            Seasons Full-Time lists for this league
          </p>
          <ul className="space-y-0.5 text-xs">
            {seasons.map((season) => (
              <li key={season.id}>
                <span className="font-mono">{season.id}</span> — {season.name}
                {season.selected && <span className="ml-1 text-emerald-700">(selected on the page)</span>}
                {preview.ids?.seasonId === season.id && (
                  <span className="ml-1 text-primary">(this link)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {clubSeasons.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Club seasons in this system</p>
          <ul className="space-y-0.5 text-xs">
            {clubSeasons.map((season) => (
              <li key={season.id}>
                <span className="font-mono">{season.id}</span> — {season.name}
                {season.is_current && <span className="ml-1 text-emerald-700">(current)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Rows the parser could not read
          </p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {warnings.map((warning, i) => (
              <li key={i} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
