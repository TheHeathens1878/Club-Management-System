import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { formatBookingDateShort } from "@/lib/booking-time";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Link2,
  Link2Off,
  Plus,
} from "lucide-react";
import { createSeason, createTeam, setCurrentSeason, setTeamActive } from "./actions";

/** How the last import went, as a badge the admin can read at a glance. */
function importBadge(status: string | null): { label: string; variant: "success" | "warning" | "destructive" | "muted" } {
  if (status === "ok") return { label: "Last import OK", variant: "success" };
  if (status === "challenge") return { label: "Blocked by Cloudflare", variant: "warning" };
  if (status === "error") return { label: "Last import failed", variant: "destructive" };
  return { label: "Not imported yet", variant: "muted" };
}

function formatStamp(iso: string | null): string {
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

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/room-bookings");

  const { saved, error: errorParam } = await searchParams;
  const admin = createAdminClient();

  const [teamsResult, linksResult, seasonsResult] = await Promise.all([
    admin.from("teams").select("*").order("sort_order").order("name"),
    admin
      .from("team_fulltime_links")
      .select("team_id,enabled,last_import_status,last_import_at,last_import_count,last_error"),
    admin.from("seasons").select("*").order("starts_on", { ascending: false }),
  ]);

  const teams = teamsResult.data ?? [];
  const seasons = seasonsResult.data ?? [];
  const linkByTeam = new Map((linksResult.data ?? []).map((l) => [l.team_id, l]));
  const loadError = teamsResult.error ?? linksResult.error ?? seasonsResult.error;

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle="Club teams, their seasons, and each team's FA Full-Time link"
      />
      <div className="p-6 space-y-6 max-w-4xl">
        {saved && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {saved === "season" ? "Season saved." : "Team saved."}
          </div>
        )}
        {errorParam && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorParam}
          </div>
        )}
        {loadError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Could not load teams and seasons.
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Teams                                                            */}
        {/* ---------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Teams</CardTitle>
            <p className="text-sm text-muted-foreground">
              Open a team to paste its Full-Time URL, preview the fixtures the parser reads, and save the link.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {teams.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No teams yet. Add the first one below.
              </p>
            )}

            {teams.map((team) => {
              const link = linkByTeam.get(team.id);
              const badge = importBadge(link?.last_import_status ?? null);
              return (
                <div key={team.id} className="rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/teams/${team.id}`}
                        className="flex items-center gap-1 text-sm font-medium hover:underline"
                      >
                        {team.name}
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {team.age_group ? team.age_group : "No age group"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={team.active ? "success" : "muted"}>
                        {team.active ? "Active" : "Inactive"}
                      </Badge>
                      {link ? (
                        <>
                          <Badge variant={link.enabled ? "default" : "muted"} className="gap-1">
                            <Link2 className="h-3 w-3" />
                            {link.enabled ? "Full-Time linked" : "Link paused"}
                          </Badge>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </>
                      ) : (
                        <Badge variant="muted" className="gap-1">
                          <Link2Off className="h-3 w-3" /> No Full-Time link
                        </Badge>
                      )}
                    </div>
                  </div>

                  {link && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Last import {formatStamp(link.last_import_at)}
                      {typeof link.last_import_count === "number" && ` · ${link.last_import_count} fixtures`}
                    </p>
                  )}
                  {link?.last_error && (
                    <p className="mt-1 text-xs text-destructive break-words">{link.last_error}</p>
                  )}

                  <form action={setTeamActive} className="mt-3">
                    <input type="hidden" name="team_id" value={team.id} />
                    <input type="hidden" name="active" value={team.active ? "false" : "true"} />
                    <button
                      type="submit"
                      className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary"
                    >
                      {team.active ? "Mark inactive" : "Mark active"}
                    </button>
                  </form>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4" /> Add a team
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createTeam} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="team-name">Team name *</Label>
                  <Input id="team-name" name="name" placeholder="e.g. AoM FC First Team" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="team-age">Age group</Label>
                  <Input id="team-age" name="age_group" placeholder="e.g. Under 12s, Open age" />
                </div>
              </div>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" /> Create team
              </button>
            </form>
          </CardContent>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* Seasons                                                          */}
        {/* ---------------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Seasons</CardTitle>
            <p className="text-sm text-muted-foreground">
              Fixtures belong to a season. Exactly one season can be current at a time.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {seasons.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No seasons yet. Add one before importing fixtures.
              </p>
            )}

            {seasons.map((season) => (
              <div
                key={season.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{season.name}</span>
                    {season.is_current && <Badge variant="success">Current</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatBookingDateShort(season.starts_on)} – {formatBookingDateShort(season.ends_on)}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground break-all">{season.id}</p>
                </div>
                {!season.is_current && (
                  <form action={setCurrentSeason}>
                    <input type="hidden" name="season_id" value={season.id} />
                    <button
                      type="submit"
                      className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary"
                    >
                      Make current
                    </button>
                  </form>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4" /> Add a season
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createSeason} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="season-name">Name *</Label>
                  <Input id="season-name" name="name" placeholder="e.g. 2026/27" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="season-start">Starts on *</Label>
                  <Input id="season-start" name="starts_on" type="date" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="season-end">Ends on *</Label>
                  <Input id="season-end" name="ends_on" type="date" required />
                </div>
              </div>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" /> Create season
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
