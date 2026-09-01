"use client";

/**
 * The club-wide Full-Time widgets card: paste the club's "fixtures" and
 * "results" snippets once and every active team without its own link is fed
 * from them. All parsing and fetching happens in server actions.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import {
  previewClubWidget,
  runClubImport,
  saveClubWidgetCodes,
  type ClubRunResult,
  type ClubWidgetPreview,
} from "./club-widgets-actions";

function SnippetField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder={'<div id="lrep…">…</div>\n<script>var lrcode = \'…\'</script>…'}
        className="w-full break-all rounded-md border border-input bg-card px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function PreviewBlock({ title, preview }: { title: string; preview: ClubWidgetPreview }) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">
        {title}
        {preview.code && <span className="ml-2 font-mono text-xs text-muted-foreground">{preview.code}</span>}
        {typeof preview.total === "number" && (
          <span className="ml-2 text-xs text-muted-foreground">{preview.total} fixtures</span>
        )}
      </p>
      {preview.message && (
        <p className={`flex items-start gap-1.5 text-xs ${preview.ok ? "text-amber-700" : "text-destructive"}`}>
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{preview.message}</span>
        </p>
      )}
      {(preview.matched?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {preview.matched!.map(({ team, count }) => (
            <span key={team} className="rounded-full border px-2.5 py-0.5 text-xs">
              {team} <span className="text-muted-foreground">×{count}</span>
            </span>
          ))}
        </div>
      )}
      {(preview.unmatchedOwn?.length ?? 0) > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            In the widget but matching no team here: {preview.unmatchedOwn!.join("; ")} — add or rename those
            teams if they should import.
          </span>
        </p>
      )}
      {(preview.warnings?.length ?? 0) > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {preview.warnings!.map((w, i) => (
            <li key={i} className="break-words">
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ClubWidgetsPanel({
  fixturesCode,
  resultsCode,
}: {
  fixturesCode: string | null;
  resultsCode: string | null;
}) {
  const router = useRouter();
  const [fixtures, setFixtures] = useState(fixturesCode ?? "");
  const [results, setResults] = useState(resultsCode ?? "");
  const [previews, setPreviews] = useState<{ fixtures?: ClubWidgetPreview; results?: ClubWidgetPreview }>({});
  const [busy, setBusy] = useState<null | "preview" | "save" | "run">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [run, setRun] = useState<ClubRunResult | null>(null);

  async function runPreview() {
    setError(null);
    setSaved(false);
    setBusy("preview");
    const next: typeof previews = {};
    if (fixtures.trim() !== "") next.fixtures = await previewClubWidget(fixtures);
    if (results.trim() !== "") next.results = await previewClubWidget(results);
    setBusy(null);
    setPreviews(next);
  }

  async function runSave() {
    setError(null);
    setBusy("save");
    const result = await saveClubWidgetCodes({ fixtures, results });
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function runNow() {
    setError(null);
    setRun(null);
    setBusy("run");
    const result = await runClubImport();
    setBusy(null);
    setRun(result);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <SnippetField
        id="club-fixtures"
        label="Club fixtures widget"
        hint="Full-Time → the club → Add to your website → club fixtures. Fixtures for every team; no scores. Write each code's league name in front of it — “Timperley & District JFL: 885630049, SMGFL: 123456789” — and teams fed by that widget get their League filled in on the next import (blank League only; hand edits are never overwritten)."
        value={fixtures}
        onChange={setFixtures}
      />
      <SnippetField
        id="club-results"
        label="Club results widget"
        hint="The matching club results widget — scores arrive through this one after matches are played."
        value={results}
        onChange={setResults}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={runPreview}
          disabled={busy !== null || (fixtures.trim() === "" && results.trim() === "")}
        >
          {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Test &amp; preview
        </Button>
        <Button size="sm" onClick={runSave} disabled={busy !== null}>
          {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save codes
        </Button>
        <Button size="sm" variant="outline" onClick={runNow} disabled={busy !== null}>
          {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Import all teams now
        </Button>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      {saved && (
        <p className="flex items-center gap-1.5 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> Club widget codes saved. The nightly import uses them; teams with
          their own Full-Time link keep it.
        </p>
      )}

      {previews.fixtures && <PreviewBlock title="Fixtures widget" preview={previews.fixtures} />}
      {previews.results && <PreviewBlock title="Results widget" preview={previews.results} />}

      {run && (
        <div
          className={
            "rounded-md border px-3 py-2 text-xs " +
            (run.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-destructive/40 bg-destructive/5 text-destructive")
          }
        >
          <p className="font-medium">
            {run.ok ? "Import ran." : run.message ?? "Import failed."}
            {run.status ? ` HTTP ${run.status}` : ""}
          </p>
          {run.body && (
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">
              {run.body}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
