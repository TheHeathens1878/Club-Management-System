/**
 * The Match stats tab (Adam, 2026-08-25: "match-stats (simple... captain,
 * goals, assists, player of the match etc)").
 *
 * Everyone who may read `fixture_player_stats` — the squad, their parents, the
 * team's staff, the club's admins — sees the table. The team's staff and club
 * admins also get the form underneath it, one line per live player in the
 * squad, saved whole through `set_fixture_stats()`.
 *
 * A player with nothing to show is not stored, so the table is the match's
 * facts rather than a grid of zeroes; the form still lists the whole squad,
 * because that is how a coach fills it in.
 */

import { Award, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { MatchStatsForm, type StatsPlayer } from "./match-stats-form";

export async function MatchStatsSection({
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

  const [statsResult, membershipResult] = await Promise.all([
    supabase
      .from("fixture_player_stats")
      .select("person_id,goals,assists,captain,player_of_match")
      .eq("fixture_id", fixtureId),
    supabase
      .from("team_memberships")
      .select("person_id,role,shirt_number")
      .eq("team_id", teamId)
      .is("left_at", null),
  ]);

  const stats = statsResult.data ?? [];
  // A parent's client only gets their own household's membership rows back, so
  // the squad is "whoever I can see" plus anyone already on the sheet.
  const squadIds = (membershipResult.data ?? [])
    .filter((row) => row.role === "player")
    .map((row) => row.person_id);
  const shirtByPerson = new Map(
    (membershipResult.data ?? []).map((row) => [row.person_id, row.shirt_number]),
  );
  const peopleIds = Array.from(new Set([...squadIds, ...stats.map((row) => row.person_id)]));
  const names = await resolveNames(peopleIds);

  const byPerson = new Map(stats.map((row) => [row.person_id, row]));

  const players: StatsPlayer[] = peopleIds
    .map((personId) => {
      const row = byPerson.get(personId);
      return {
        personId,
        name: nameOf(names, personId),
        shirtNumber: shirtByPerson.get(personId) ?? null,
        goals: row?.goals ?? 0,
        assists: row?.assists ?? 0,
        captain: row?.captain ?? false,
        playerOfMatch: row?.player_of_match ?? false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const recorded = players.filter(
    (player) => player.goals > 0 || player.assists > 0 || player.captain || player.playerOfMatch,
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Match stats</CardTitle>
          <p className="text-xs text-muted-foreground">
            Goals, assists, the captain and the player of the match — as the coach recorded them.
          </p>
        </CardHeader>
        <CardContent>
          {recorded.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recorded for this match yet.
            </p>
          ) : (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[20rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pr-2 font-medium">
                      Player
                    </th>
                    <th scope="col" className="py-2 px-2 text-right font-medium">
                      Goals
                    </th>
                    <th scope="col" className="py-2 pl-2 text-right font-medium">
                      Assists
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recorded.map((player) => (
                    <tr key={player.personId} className="border-b last:border-0">
                      <td className="py-2 pr-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {player.shirtNumber === null ? null : (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {player.shirtNumber}
                            </span>
                          )}
                          <span className="font-medium">{player.name}</span>
                          {player.captain ? (
                            <Badge variant="outline" title="Captain">
                              <ShieldCheck className="mr-1 h-3 w-3" /> C
                            </Badge>
                          ) : null}
                          {player.playerOfMatch ? (
                            <Badge variant="success" title="Player of the match">
                              <Award className="mr-1 h-3 w-3" /> Player of the match
                            </Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {player.goals > 0 ? player.goals : "—"}
                      </td>
                      <td className="py-2 pl-2 text-right tabular-nums">
                        {player.assists > 0 ? player.assists : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <MatchStatsForm
          eventId={eventId}
          teamId={teamId}
          fixtureId={fixtureId}
          players={players}
        />
      ) : null}
    </div>
  );
}
