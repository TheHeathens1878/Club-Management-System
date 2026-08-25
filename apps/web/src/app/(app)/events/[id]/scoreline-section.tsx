/**
 * The Scoreline tab (Adam, 2026-08-25: "Full-Time will only import scorelines
 * for U12 and above so where it comes through as X-X, the coach's score will
 * over-ride it").
 *
 * The number on screen is whatever `effectiveScore()` says it is — the coach's
 * pair when they have entered one, otherwise Full-Time's — and the tab always
 * says which of the two it is looking at, because "3–1" with no provenance is
 * the thing a parent would argue with.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { effectiveScore, scoreSourceLabel, scorelineLabel } from "@/lib/scoreline";
import { createClient } from "@/lib/supabase/server";

import { ScorelineForm } from "./scoreline-form";

const OUTCOME: Record<"win" | "draw" | "loss", { label: string; variant: "success" | "muted" | "destructive" }> = {
  win: { label: "Won", variant: "success" },
  draw: { label: "Drew", variant: "muted" },
  loss: { label: "Lost", variant: "destructive" },
};

export async function ScorelineSection({
  eventId,
  teamId,
  fixtureId,
  canManage,
}: {
  eventId: string;
  teamId: string;
  fixtureId: string;
  canManage: boolean;
}) {
  const supabase = await createClient();
  const { data: fixture } = await supabase
    .from("fixtures")
    .select(
      "id,is_home,opponent,status,home_score,away_score,coach_home_score,coach_away_score,teams:team_id(name)",
    )
    .eq("id", fixtureId)
    .eq("team_id", teamId)
    .maybeSingle();

  if (!fixture) {
    return <p className="text-sm text-muted-foreground">This match could not be read.</p>;
  }

  const teamName = (fixture.teams as { name: string } | null)?.name ?? "Our team";
  const scores = {
    homeScore: fixture.home_score,
    awayScore: fixture.away_score,
    coachHomeScore: fixture.coach_home_score,
    coachAwayScore: fixture.coach_away_score,
  };
  const score = effectiveScore(scores);
  const ours = scorelineLabel({ ...scores, isHome: fixture.is_home });
  const homeName = fixture.is_home ? teamName : fixture.opponent;
  const awayName = fixture.is_home ? fixture.opponent : teamName;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scoreline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {score && ours ? (
            <>
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center">
                <span className="min-w-0 flex-1 basis-24 text-right text-sm font-medium sm:text-base">
                  {homeName}
                </span>
                <span className="font-display text-4xl font-semibold tabular-nums sm:text-5xl">
                  {score.home}–{score.away}
                </span>
                <span className="min-w-0 flex-1 basis-24 text-left text-sm font-medium sm:text-base">
                  {awayName}
                </span>
              </div>
              <p className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
                <Badge variant={OUTCOME[ours.outcome].variant}>
                  {OUTCOME[ours.outcome].label} {ours.text}
                </Badge>
                <span>{scoreSourceLabel(score.source)}</span>
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No result yet.{" "}
              {fixture.status === "played"
                ? "The match has been played but nobody has recorded the score."
                : "Come back after the match."}
            </p>
          )}

          {/* Adam's rule, said once, on the tab it applies to. */}
          <p className="text-xs text-muted-foreground">
            Full-Time only publishes results for U12 and above, so the coach&apos;s score is what
            everyone sees whenever one has been entered — it overrides anything the importer
            brought in.
          </p>
        </CardContent>
      </Card>

      {canManage ? (
        <ScorelineForm
          eventId={eventId}
          teamId={teamId}
          fixtureId={fixtureId}
          homeName={homeName}
          awayName={awayName}
          coachHome={fixture.coach_home_score}
          coachAway={fixture.coach_away_score}
          importedHome={fixture.home_score}
          importedAway={fixture.away_score}
        />
      ) : null}
    </div>
  );
}
