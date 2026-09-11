"use client";

import { useEffect } from "react";

/**
 * The boundary of last resort: only reached when the root layout itself
 * fails, so it must draw its own <html> and <body> and can lean on nothing.
 * Kept to plain elements and inline styles for that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en-GB">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f4f4f5", color: "#111827" }}>
        <div style={{ maxWidth: 440, margin: "15vh auto 0", padding: 24, background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.1)" }}>
          <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#4b5563", margin: "0 0 16px", lineHeight: 1.5 }}>
            Anything you had just saved is safe. Reload the page; if it keeps happening, tell the club
            {error.digest ? ` and quote code ${error.digest}` : ""}.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "10px 16px", fontSize: 14, borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", marginRight: 8 }}
          >
            Reload
          </button>
          <button
            onClick={reset}
            style={{ padding: "10px 16px", fontSize: 14, borderRadius: 8, border: 0, background: "#1249bf", color: "#fff", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
