/**
 * Every Badge variant at once — the smallest thing the harness can prove, and
 * the one that catches a palette literal fastest: a badge is nothing but a
 * colour pair, so if a variant is still spelt `bg-emerald-100` the tokens-only
 * assertion says so by name.
 */

import { Badge } from "@/components/ui/badge";

import type { Fixture } from "./contract";

const VARIANTS = ["default", "success", "warning", "muted", "destructive", "outline"] as const;

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl space-y-4 p-4">{children}</div>;
}

const fixture: Fixture = {
  cases: {
    variants: () => (
      <Frame>
        {VARIANTS.map((variant) => (
          <div key={variant} className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{variant}</p>
            <Row>
              <Badge variant={variant}>{variant}</Badge>
              <Badge variant={variant}>12</Badge>
              <Badge variant={variant}>Waiting on the desk</Badge>
            </Row>
          </div>
        ))}
      </Frame>
    ),

    // Badges rarely stand alone; in a row they must wrap rather than push the
    // page sideways, which is exactly what the 390 shot checks.
    inARow: () => (
      <Frame>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="font-display text-panel font-semibold">U14 Mavericks</p>
          <Row>
            {VARIANTS.map((variant) => (
              <Badge key={variant} variant={variant}>
                {variant === "muted" ? "3 of 4 free" : variant}
              </Badge>
            ))}
          </Row>
        </div>
      </Frame>
    ),
  },
};

export default fixture;
