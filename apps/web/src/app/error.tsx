"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The page-level error boundary. Until 2026-09-11 there was none, so every
 * browser-side failure showed Next's bare "Application error: a client-side
 * exception has occurred" — including the commonest one, which is not a
 * bug at all: a deploy landing while a tab is open. The tab's old JavaScript
 * then asks for chunks that no longer exist, or posts a server action the
 * new build does not know, and the navigation after a form submit dies.
 * That case reloads itself once; everything else gets a plain message,
 * a retry and a way home.
 */

const RELOAD_FLAG = "cms-stale-reload";

function looksLikeStaleDeploy(error: Error & { digest?: string }): boolean {
  const text = `${error.name} ${error.message}`.toLowerCase();
  return (
    error.name === "ChunkLoadError" ||
    text.includes("loading chunk") ||
    text.includes("failed to fetch dynamically imported module") ||
    text.includes("importing a module script failed") ||
    text.includes("failed to find server action") ||
    (text.includes("server action") && text.includes("not found"))
  );
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    console.error("[error boundary]", error);
    if (!looksLikeStaleDeploy(error)) return;
    let alreadyReloaded = false;
    try {
      alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === "1";
      if (!alreadyReloaded) sessionStorage.setItem(RELOAD_FLAG, "1");
    } catch {
      /* storage unavailable: reload anyway, just the once per mount */
    }
    if (alreadyReloaded) return;
    setReloading(true);
    window.location.reload();
  }, [error]);

  useEffect(() => {
    // A page that has rendered normally clears the flag, so the NEXT deploy
    // gets its one automatic reload too.
    return () => {
      try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
    };
  }, []);

  if (reloading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6 text-sm text-muted-foreground">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> The app was updated — reloading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-6 pt-16">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <div className="space-y-1">
            <h1 className="text-base font-semibold">Something went wrong on this page</h1>
            <p className="text-sm text-muted-foreground">
              Anything you had just saved is safe. Try again, or reload the page — if it keeps
              happening, tell the club with the code below.
            </p>
            {error.digest && (
              <p className="font-mono text-xs text-muted-foreground">Code {error.digest}</p>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button onClick={reset} className="min-h-[44px] sm:min-h-0">Try again</Button>
          <Button variant="outline" onClick={() => window.location.reload()} className="min-h-[44px] sm:min-h-0">
            <RefreshCw className="h-4 w-4" /> Reload
          </Button>
          <Button variant="ghost" onClick={() => { window.location.href = "/"; }} className="min-h-[44px] sm:min-h-0">
            Home
          </Button>
        </div>
      </div>
    </div>
  );
}
