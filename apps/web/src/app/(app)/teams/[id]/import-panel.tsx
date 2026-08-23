"use client";

/**
 * Manual fixture import (PLAN.md P2.4) — the fallback that has to work when
 * the scheduled importer does not.
 *
 * Two tabs, one destination. Paste a Full-Time address and the server fetches
 * and parses it exactly as the nightly job does; or paste a CSV and the same
 * parser package reads it with no network at all. Either way the admin sees
 * the fixtures before anything is written, and "Import" hands them to
 * `import_fixtures()`.
 *
 * No Full-Time knowledge lives in this file: everything arrives already
 * parsed, classified and formatted from the server actions.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, PlayCircle } from "lucide-react";
import {
  previewManualCsv,
  previewManualUrl,
  runManualImport,
  triggerScheduledImport,
  type EdgeFunctionResult,
  type ManualImportResult,
  type ManualPreview,
} from "./import-actions";

export type ImportRunView = {
  id: number;
  trigger: string;
  status: string;
  inserted: number;
  updated: number;
  unchanged: number;
  error: string | null;
  source_url: string | null;
  created_at: string;
};

export type CurrentSeasonView = { id: string; name: string } | null;

const CSV_PLACEHOLDER = `date,time,home,away,competition,venue,status
2026-09-19,10:30,AoM U13s,Angel FC U13s,Division 2,Home,scheduled
2026-09-26,14:00,Angel FC U13s,AoM U13s,Division 2,Away,scheduled`;

function stamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function runVariant(status: string): "success" | "warning" | "destructive" | "muted" {
  if (status === "ok") return "success";
  if (status === "challenge") return "warning";
  if (status === "error") return "destructive";
  return "muted";
}

export function ManualImportPanel({
  teamId,
  teamName,
  ftTeamName,
  currentSeason,
  runs,
}: {
  teamId: string;
  teamName: string;
  ftTeamName: string;
  currentSeason: CurrentSeasonView;
  runs: ImportRunView[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"url" | "csv">("url");
  const [url, setUrl] = useState("");
  const [csv, setCsv] = useState("");
  const [matchName, setMatchName] = useState(ftTeamName);
  const [preview, setPreview] = useState<ManualPreview | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "import" | "scheduled">(null);
  const [result, setResult] = useState<ManualImportResult | null>(null);
  const [edge, setEdge] = useState<EdgeFunctionResult | null>(null);

  const canImport =
    currentSeason !== null && preview?.payload !== undefined && preview.payload.length > 0;

  function switchTab(next: "url" | "csv") {
    setTab(next);
    setPreview(null);
    setResult(null);
  }

  async function runPreview() {
    setResult(null);
    setBusy("preview");
    const next =
      tab === "url"
        ? await previewManualUrl(teamId, url, matchName)
        : await previewManualCsv(teamId, csv, matchName);
    setBusy(null);
    setPreview(next);
  }

  async function runImport() {
    if (!preview?.payload) return;
    setBusy("import");
    const next = await runManualImport(teamId, {
      trigger: tab === "url" ? "manual_url" : "manual_csv",
      sourceUrl: tab === "url" ? (preview.fetchedUrl ?? url) : null,
      fixtures: preview.payload,
      warnings: preview.warnings ?? [],
    });
    setBusy(null);
    setResult(next);
    if (!next.error) {
      setPreview(null);
      router.refresh();
    }
  }

  async function runScheduled() {
    setEdge(null);
    setBusy("scheduled");
    const next = await triggerScheduledImport(teamId);
    setBusy(null);
    setEdge(next);
    if (next.ok) router.refresh();
  }

  const rows = preview?.rows ?? [];
  const warnings = preview?.warnings ?? [];

  return (
    <div className="space-y-5">
      {currentSeason === null ? (
        <p className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            No season is marked as the current one, so there is nowhere to put imported fixtures.
            Set the current season on the Teams screen first.
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Fixtures will be imported into <span className="font-medium">{currentSeason.name}</span>{" "}
          for {teamName}.
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Tabs                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex gap-1 border-b">
        {(
          [
            ["url", "Paste a Full-Time URL"],
            ["csv", "Paste CSV"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => switchTab(key)}
            className={
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors " +
              (tab === key
                ? "border-primary font-medium text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "url" ? (
        <div className="space-y-1.5">
          <Label htmlFor="manual-url">Full-Time fixtures URL</Label>
          <textarea
            id="manual-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="https://fulltime.thefa.com/fixtures.html?league=…&selectedSeason=…&selectedDivision=…"
            className="w-full break-all rounded-md border border-input bg-card px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Fetched here on the server with the same parser the nightly importer uses. If Cloudflare
            is blocking us, use the CSV tab.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="manual-csv">Fixtures CSV</Label>
          <textarea
            id="manual-csv"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={CSV_PLACEHOLDER}
            className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            A header row is required. <code>date,time,home,away,competition,venue,status</code> —
            columns may be in any order, and common alternative names are understood. Dates and
            times are Europe/London.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="manual-match-name">Team name to match</Label>
        <Input
          id="manual-match-name"
          value={matchName}
          onChange={(e) => setMatchName(e.target.value)}
          placeholder={teamName}
        />
        <p className="text-xs text-muted-foreground">
          Rows are matched on this name, exactly as printed — it decides home from away.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={runPreview}
          disabled={busy !== null || (tab === "url" ? url.trim() === "" : csv.trim() === "")}
        >
          {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Preview
        </Button>
        <Button size="sm" onClick={runImport} disabled={busy !== null || !canImport}>
          {busy === "import" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {preview?.payload?.length
            ? `Import these ${preview.payload.length} fixtures`
            : "Import fixtures"}
        </Button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Preview                                                            */}
      {/* ------------------------------------------------------------------ */}
      {preview && (
        <div className="space-y-3 rounded-lg border p-4">
          {preview.message !== "" && (
            <p
              className={
                preview.ok
                  ? "flex items-start gap-2 text-sm text-amber-700"
                  : "flex items-start gap-2 text-sm text-destructive"
              }
            >
              {preview.ok ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span className="break-words">{preview.message}</span>
            </p>
          )}

          {preview.fetchedUrl && (
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              Fetched {preview.fetchedUrl}
              {preview.httpStatus ? ` · HTTP ${preview.httpStatus}` : ""}
            </p>
          )}

          {rows.length > 0 && (
            <>
              <p className="text-sm font-medium">
                {preview.matchedCount} fixture{preview.matchedCount === 1 ? "" : "s"} for{" "}
                <span className="font-semibold">{preview.ftTeamName}</span>
                {(preview.matchedCount ?? 0) > rows.length &&
                  ` — showing the first ${rows.length}`}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b text-muted-foreground">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Date</th>
                      <th className="py-1.5 pr-3 font-medium">Time</th>
                      <th className="py-1.5 pr-3 font-medium">H/A</th>
                      <th className="py-1.5 pr-3 font-medium">Opponent</th>
                      <th className="py-1.5 pr-3 font-medium">Competition</th>
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
                        <td className="py-1.5 pr-3">{row.competition}</td>
                        <td className="py-1.5 capitalize">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {preview.teamNames && preview.teamNames.length > 0 && rows.length === 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Team names in that file — click one to use it
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preview.teamNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setMatchName(name)}
                    className="rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-secondary"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {warnings.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> Rows that could not be read
              </p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {warnings.map((warning, i) => (
                  <li key={i} className="break-words">
                    {warning}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                They are recorded with the import run so a change to Full-Time&apos;s markup shows
                up rather than passing silently.
              </p>
            </div>
          )}
        </div>
      )}

      {result?.error && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{result.error}</span>
        </p>
      )}
      {result && !result.error && (
        <p className="flex items-start gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Imported: {result.inserted} new, {result.updated} updated, {result.unchanged} unchanged.
          </span>
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* The scheduled path, on demand                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Run the scheduled import now</p>
            <p className="text-xs text-muted-foreground">
              Calls the <code>fulltime-import</code> Edge Function for this team — the same code the
              nightly job runs.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={runScheduled} disabled={busy !== null}>
            {busy === "scheduled" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            Run now
          </Button>
        </div>
        {edge && (
          <div className="space-y-1.5">
            {edge.message && (
              <p
                className={
                  edge.ok
                    ? "text-xs text-muted-foreground"
                    : "flex items-start gap-1.5 text-xs text-destructive"
                }
              >
                {!edge.ok && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span className="break-words">{edge.message}</span>
              </p>
            )}
            {edge.body && (
              <pre className="max-h-56 overflow-auto rounded-md border bg-card p-2 text-[11px] leading-tight">
                {edge.body}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Recent runs                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div>
        <p className="mb-2 text-sm font-medium">Recent import runs</p>
        {runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No import has been attempted for this team yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">When</th>
                  <th className="py-1.5 pr-3 font-medium">Trigger</th>
                  <th className="py-1.5 pr-3 font-medium">Outcome</th>
                  <th className="py-1.5 pr-3 font-medium">New</th>
                  <th className="py-1.5 pr-3 font-medium">Updated</th>
                  <th className="py-1.5 pr-3 font-medium">Unchanged</th>
                  <th className="py-1.5 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap py-1.5 pr-3">{stamp(run.created_at)}</td>
                    <td className="py-1.5 pr-3">{run.trigger.replace("_", " ")}</td>
                    <td className="py-1.5 pr-3">
                      <Badge variant={runVariant(run.status)}>{run.status}</Badge>
                    </td>
                    <td className="py-1.5 pr-3">{run.inserted}</td>
                    <td className="py-1.5 pr-3">{run.updated}</td>
                    <td className="py-1.5 pr-3">{run.unchanged}</td>
                    <td className="py-1.5 break-words text-destructive">{run.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
