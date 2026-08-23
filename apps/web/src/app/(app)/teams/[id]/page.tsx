import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";
import { ChevronLeft } from "lucide-react";
import { FullTimePanel, type ClubSeasonView, type FullTimeLinkView } from "./fulltime-panel";

/** Next 20 fixtures, read-only — the importer (P2.4) is what writes them. */
const UPCOMING_LIMIT = 20;

function statusVariant(status: string): "success" | "muted" | "destructive" | "warning" | "default" {
  if (status === "played") return "success";
  if (status === "cancelled" || status === "abandoned") return "destructive";
  if (status === "postponed") return "warning";
  return "default";
}

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/room-bookings");

  const { id } = await params;
  const admin = createAdminClient();

  const nowIso = new Date().toISOString();
  const [teamResult, linkResult, seasonsResult, fixturesResult] = await Promise.all([
    admin.from("teams").select("*").eq("id", id).maybeSingle(),
    admin.from("team_fulltime_links").select("*").eq("team_id", id).maybeSingle(),
    admin.from("seasons").select("id,name,is_current").order("starts_on", { ascending: false }),
    admin
      .from("fixtures")
      .select("id,kickoff_at,is_home,opponent,competition,status,source,venue_text,seasons(name)")
      .eq("team_id", id)
      .gte("kickoff_at", nowIso)
      .order("kickoff_at")
      .limit(UPCOMING_LIMIT),
  ]);

  const team = teamResult.data;
  if (!team) notFound();

  const linkRow = linkResult.data;
  const link: FullTimeLinkView | null = linkRow
    ? {
        source_url: linkRow.source_url,
        league_id: linkRow.league_id,
        ft_season_id: linkRow.ft_season_id,
        division_id: linkRow.division_id,
        fixture_group_key: linkRow.fixture_group_key,
        ft_team_id: linkRow.ft_team_id,
        ft_team_name: linkRow.ft_team_name,
        enabled: linkRow.enabled,
        last_import_at: linkRow.last_import_at,
        last_import_status: linkRow.last_import_status,
        last_import_count: linkRow.last_import_count,
        last_error: linkRow.last_error,
      }
    : null;

  const clubSeasons: ClubSeasonView[] = (seasonsResult.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    is_current: s.is_current,
  }));

  const fixtures = fixturesResult.data ?? [];

  return (
    <>
      <PageHeader
        title={team.name}
        subtitle={team.age_group ?? "No age group"}
        action={
          <Link href="/teams" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ChevronLeft className="h-4 w-4" /> Back to teams
          </Link>
        }
      />
      <div className="max-w-4xl space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={team.active ? "success" : "muted"}>{team.active ? "Active" : "Inactive"}</Badge>
          {link && (
            <Badge variant={link.enabled ? "default" : "muted"}>
              {link.enabled ? "Full-Time import enabled" : "Full-Time import paused"}
            </Badge>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>FA Full-Time link</CardTitle>
            <p className="text-sm text-muted-foreground">
              The FA publishes no fixtures API, so fixtures are read from public Full-Time pages. Paste the
              team&apos;s Full-Time address, preview what the parser reads, then save. Re-linking for a new
              season or a new league updates this link and keeps the fixtures already imported.
            </p>
          </CardHeader>
          <CardContent>
            <FullTimePanel teamId={team.id} teamName={team.name} link={link} clubSeasons={clubSeasons} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming fixtures</CardTitle>
            <p className="text-sm text-muted-foreground">
              The next {UPCOMING_LIMIT} kick-offs for this team, in Europe/London. Read-only here — fixtures
              arrive from the importer or the manual entry screen.
            </p>
          </CardHeader>
          <CardContent>
            {fixturesResult.error && (
              <p className="text-sm text-destructive">Could not load this team&apos;s fixtures.</p>
            )}
            {!fixturesResult.error && fixtures.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No upcoming fixtures for this team.
              </p>
            )}
            {fixtures.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">H/A</th>
                      <th className="py-2 pr-3 font-medium">Opponent</th>
                      <th className="py-2 pr-3 font-medium">Competition</th>
                      <th className="py-2 pr-3 font-medium">Season</th>
                      <th className="py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fixtures.map((fixture) => {
                      const local = instantToLocal(fixture.kickoff_at);
                      return (
                        <tr key={fixture.id} className="border-b last:border-0">
                          <td className="whitespace-nowrap py-2 pr-3">
                            {formatBookingDateShort(local.date)}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-3">{local.time}</td>
                          <td className="py-2 pr-3">{fixture.is_home ? "Home" : "Away"}</td>
                          <td className="py-2 pr-3">
                            {fixture.opponent}
                            {fixture.venue_text && (
                              <span className="block text-xs text-muted-foreground">{fixture.venue_text}</span>
                            )}
                          </td>
                          <td className="py-2 pr-3">{fixture.competition ?? "—"}</td>
                          <td className="py-2 pr-3">{fixture.seasons?.name ?? "—"}</td>
                          <td className="py-2">
                            <Badge variant={statusVariant(fixture.status)} className="capitalize">
                              {fixture.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
