import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FA_FORMATS, faFormatFor, type FaFormat } from "@/lib/fa-formats";

/**
 * The Teams page's "Formats & rules" tab (design build, 2026-08-25): the FA's
 * age-group rules as a reference table, with the age groups the club currently
 * fields highlighted and named; then what the club fields by format, which
 * pitches fit what, and what the next rollover changes.
 *
 * Everything here is derived — the FA table from `lib/fa-formats`, the
 * highlights and counts from the teams already loaded for the list. Nothing is
 * stored per team.
 */

export type FormatsTeam = {
  id: string;
  name: string;
  ageGroup: string | null;
  active: boolean;
};

export type FormatsPitch = { id: string; name: string };

/** "9v9" out of "Ashton Park – Pitch 1 (9v9 Left)" — best effort, else null. */
function pitchFormatLabel(name: string): string | null {
  const specific = name.match(/\b(\d{1,2}v\d{1,2})\b/i)?.[1];
  if (specific) return specific.toLocaleLowerCase("en-GB");
  if (/training|grid|festival/i.test(name)) return "training and festivals";
  return null;
}

export function FormatsPanel({ teams, pitches }: { teams: FormatsTeam[]; pitches: FormatsPitch[] }) {
  const active = teams.filter((team) => team.active);

  // Which FA age rows the club fields, and by which teams.
  const teamsByAge = new Map<string, string[]>();
  const countsByFormat = new Map<string, number>();
  let noFormat = 0;
  for (const team of active) {
    const rules = faFormatFor(team.ageGroup);
    if (!rules) {
      noFormat += 1;
      continue;
    }
    if (!teamsByAge.has(rules.age)) teamsByAge.set(rules.age, []);
    teamsByAge.get(rules.age)?.push(team.name);
    countsByFormat.set(rules.format, (countsByFormat.get(rules.format) ?? 0) + 1);
  }

  // Rollover deltas: fielded age groups whose NEXT age plays a different game.
  const rollovers: { from: FaFormat; to: FaFormat }[] = [];
  for (const [age] of teamsByAge) {
    const index = FA_FORMATS.findIndex((row) => row.age === age);
    const from = FA_FORMATS[index];
    const to = index >= 0 ? FA_FORMATS[index + 1] : undefined;
    if (!from || !to) continue;
    if (from.format !== to.format || from.ball !== to.ball) rollovers.push({ from, to });
  }
  rollovers.sort((a, b) => FA_FORMATS.indexOf(a.from) - FA_FORMATS.indexOf(b.from));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Quick reference</CardTitle>
            <p className="text-xs text-muted-foreground">Season 2026/27 rules</p>
          </div>
          <p className="max-w-[74ch] text-sm text-muted-foreground">
            The FA&apos;s format, match length, pitch size and ball size for each age group.
            Highlighted rows are age groups the club currently fields a team in.
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Age group</th>
                  <th className="px-4 py-2.5 font-medium">Format</th>
                  <th className="px-4 py-2.5 font-medium">Match length</th>
                  <th className="px-4 py-2.5 font-medium">Pitch size</th>
                  <th className="px-4 py-2.5 font-medium">Ball</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Teams</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {FA_FORMATS.map((row) => {
                  const fielded = teamsByAge.get(row.age) ?? [];
                  const highlighted = fielded.length > 0;
                  return (
                    <tr key={row.age} className={highlighted ? "bg-primary/5" : undefined}>
                      <td
                        className={
                          "px-4 py-2.5 font-medium" + (highlighted ? " text-primary" : "")
                        }
                      >
                        {row.age}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.format}
                        {highlighted && (
                          <span className="block text-xs text-muted-foreground">
                            {fielded.join(", ")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">{row.matchLength}</td>
                      <td className="px-4 py-2.5">{row.pitchSize}</td>
                      <td className="px-4 py-2.5">{row.ball}</td>
                      <td className="px-4 py-2.5 text-right">
                        {highlighted && (
                          <Link
                            href={`/teams?q=${encodeURIComponent(row.age)}`}
                            className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline"
                          >
                            View <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="font-display text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
              What the club fields
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              {Array.from(countsByFormat.entries())
                .sort((a, b) => a[0].localeCompare(b[0], "en-GB", { numeric: true }))
                .map(([format, count]) => (
                  <div key={format} className="flex items-baseline justify-between gap-3">
                    <dt>{format}</dt>
                    <dd className="font-medium">
                      {count} {count === 1 ? "team" : "teams"}
                    </dd>
                  </div>
                ))}
              {noFormat > 0 && (
                <div className="flex items-baseline justify-between gap-3 border-t pt-2">
                  <dt className="text-muted-foreground">No FA age group</dt>
                  <dd className="font-medium">
                    {noFormat} {noFormat === 1 ? "team" : "teams"}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="font-display text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
              Pitches that fit
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              {pitches.map((pitch) => (
                <div key={pitch.id} className="flex items-baseline justify-between gap-3">
                  <dt className="min-w-0 truncate">{pitch.name}</dt>
                  <dd className="shrink-0 text-muted-foreground">
                    {pitchFormatLabel(pitch.name) ?? "—"}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              The allocator names the clash when a fixture&apos;s slot does not fit the pitch.
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-300/60">
          <CardContent className="pt-6">
            <p className="font-display text-[10px] font-medium uppercase tracking-[0.15em] text-amber-700">
              Format changes at rollover
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              The end-of-season rollover bumps every age group, so some teams land on a new format —
              a different pitch size, longer halves and another ball size.
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              {rollovers.map(({ from, to }) => (
                <div key={from.age} className="flex items-baseline justify-between gap-3">
                  <dt>
                    {from.age} → {to.age}
                  </dt>
                  <dd className="text-muted-foreground">
                    {from.format !== to.format
                      ? `${from.format} to ${to.format}`
                      : `stays ${to.format}`}
                    {from.ball !== to.ball
                      ? ` · ${to.ball.toLocaleLowerCase("en-GB")}`
                      : ""}
                  </dd>
                </div>
              ))}
              {rollovers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No fielded age group changes format next season.
                </p>
              )}
            </dl>
            <p className="mt-3 text-sm">
              <Link href="/teams/end-of-season" className="font-semibold text-primary hover:underline">
                Open the end-of-season rollover
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
