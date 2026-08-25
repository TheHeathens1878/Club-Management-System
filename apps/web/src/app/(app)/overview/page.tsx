import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquarePlus, PenLine } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCapabilities } from "@/lib/capabilities";
import { formatEventDate, formatEventTime } from "@/app/(app)/events/shared";
import { createClient } from "@/lib/supabase/server";

/**
 * Club overview — the admin's first screen (spec §2.2): four stat cards, the
 * weekend's fixtures, and the "Needs you" list. `club_overview()` carries the
 * numbers in one call; the fixture list and the next social reuse the
 * matchday reads.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Club overview" };

const DAY_MS = 86_400_000;

function pounds(pence: number): string {
  return `£${Math.round(pence / 100).toLocaleString("en-GB")}`;
}

function num(record: Record<string, unknown> | null, key: string): number {
  const value = record?.[key];
  return typeof value === "number" ? value : 0;
}

export default async function OverviewPage() {
  const capabilities = await getCapabilities();
  if (!capabilities.isClubAdmin && !capabilities.isCommittee) redirect("/lobby");

  const supabase = await createClient();
  const now = Date.now();
  const [overviewResult, weekendResult, socialResult] = await Promise.all([
    supabase.rpc("club_overview"),
    supabase.rpc("matchday_fixtures", {
      p_from: new Date(now).toISOString(),
      p_to: new Date(now + 7 * DAY_MS).toISOString(),
    }),
    supabase.rpc("social_events", { p_limit: 1 }),
  ]);

  const o = (overviewResult.data ?? null) as Record<string, unknown> | null;
  const weekend = (weekendResult.data ?? []).filter((row) => row.status === "scheduled").slice(0, 6);
  const social = socialResult.data?.[0];

  const due = num(o, "subs_due_pence");
  const collected = num(o, "subs_collected_pence");
  const collectedPct = due > 0 ? Math.min(100, Math.round((collected / due) * 100)) : 0;
  const seasonName = typeof o?.["season_name"] === "string" ? (o["season_name"] as string) : null;

  const needs: { title: string; detail: string; href: string; tone: string }[] = [];
  if (num(o, "pending_account_requests") > 0) {
    needs.push({
      title: `${num(o, "pending_account_requests")} account request${num(o, "pending_account_requests") === 1 ? "" : "s"} awaiting approval`,
      detail: `Oldest ${num(o, "oldest_request_days")} day${num(o, "oldest_request_days") === 1 ? "" : "s"}`,
      href: "/approvals",
      tone: "bg-destructive",
    });
  }
  if (num(o, "unallocated_home_fixtures") > 0) {
    needs.push({
      title: `${num(o, "unallocated_home_fixtures")} home fixture${num(o, "unallocated_home_fixtures") === 1 ? " has" : "s have"} no pitch`,
      detail: "In the next fourteen days",
      href: "/pitches",
      tone: "bg-destructive",
    });
  }
  if (num(o, "arrears_60_count") > 0) {
    needs.push({
      title: `${num(o, "arrears_60_count")} member${num(o, "arrears_60_count") === 1 ? "" : "s"} over 60 days in arrears`,
      detail: `${pounds(num(o, "arrears_pence"))} outstanding across ${num(o, "arrears_count")}`,
      href: "/subs",
      tone: "bg-amber-600",
    });
  }
  if (social) {
    needs.push({
      title: `${social.title} — ${social.accepted} repl${social.accepted === 1 ? "y" : "ies"}`,
      detail: `${formatEventDate(social.starts_at)} · ${social.venue ?? social.team_name}`,
      href: `/events/${social.event_id}`,
      tone: "bg-muted-foreground/40",
    });
  }
  if (num(o, "pending_pitch_requests") > 0) {
    needs.push({
      title: `${num(o, "pending_pitch_requests")} pitch request${num(o, "pending_pitch_requests") === 1 ? "" : "s"} waiting`,
      detail: "Confirm or decline on the requests desk",
      href: "/pitches/requests",
      tone: "bg-muted-foreground/40",
    });
  }

  return (
    <>
      <PageHeader
        title="Club overview"
        subtitle={seasonName ? `Season ${seasonName}` : "The whole club at a glance"}
        action={
          <span className="flex gap-2">
            <Link href="/lobby/new" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <PenLine className="h-4 w-4" /> Post a notice
            </Link>
            <Link href="/messages/new" className={buttonVariants({ size: "sm" })}>
              <MessageSquarePlus className="h-4 w-4" /> New message
            </Link>
          </span>
        }
      />

      <div className="max-w-6xl space-y-6 p-6">
        {overviewResult.error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load the overview: {overviewResult.error.message}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Registered players
              </p>
              <p className="mt-2 text-3xl font-bold tracking-tight">{num(o, "players")}</p>
              {num(o, "players_this_month") > 0 ? (
                <p className="mt-1 text-xs text-emerald-700">
                  +{num(o, "players_this_month")} this month
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">across the club</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Teams active
              </p>
              <p className="mt-2 text-3xl font-bold tracking-tight">{num(o, "teams_active")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {num(o, "age_groups")} age group{num(o, "age_groups") === 1 ? "" : "s"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Subs collected
              </p>
              <p className="mt-2 text-3xl font-bold tracking-tight">{pounds(collected)}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-emerald-600"
                  style={{ width: `${collectedPct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {due > 0 ? `${collectedPct}% of ${pounds(due)} due` : "no plans set up yet"}
              </p>
            </CardContent>
          </Card>
          <Card className={num(o, "arrears_pence") > 0 ? "border-destructive/30" : undefined}>
            <CardContent className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-destructive">
                In arrears
              </p>
              <p className="mt-2 text-3xl font-bold tracking-tight text-destructive">
                {pounds(num(o, "arrears_pence"))}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {num(o, "arrears_count")} member{num(o, "arrears_count") === 1 ? "" : "s"} ·{" "}
                {num(o, "arrears_60_count")} over 60 days
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[4fr_3fr]">
          <Card>
            <CardHeader className="flex-row items-baseline justify-between space-y-0">
              <CardTitle className="text-base">This week</CardTitle>
              <Link
                href="/matches"
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                All fixtures
              </Link>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {weekend.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  No fixtures in the next seven days.
                </p>
              ) : (
                weekend.map((row) => (
                  <Link
                    key={row.fixture_id}
                    href={row.event_id ? `/events/${row.event_id}` : "/matches"}
                    className="flex items-center gap-4 px-5 py-3 text-sm transition hover:bg-secondary/40"
                  >
                    <span className="w-16 flex-none text-xs font-semibold text-muted-foreground">
                      {formatEventDate(row.kickoff_at).slice(0, 6)}
                      <br />
                      {formatEventTime(row.kickoff_at)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {row.team_name} v {row.opponent}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {row.competition ?? "League"} · {row.is_home ? "Home" : "Away"}
                      </span>
                    </span>
                    <span className="flex-none text-xs">
                      {!row.is_home ? (
                        <span className="text-muted-foreground">Away</span>
                      ) : row.pitch_name ? (
                        row.pitch_name
                      ) : (
                        <span className="text-amber-700">Unallocated</span>
                      )}
                    </span>
                    <Badge
                      variant={
                        row.squad > 0 && row.accepted * 2 < row.squad ? "warning" : "success"
                      }
                    >
                      {row.accepted} of {row.squad}
                    </Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="self-start">
            <CardHeader>
              <CardTitle className="text-base">Needs you</CardTitle>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {needs.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  Nothing waiting on you — a rare sight. Enjoy it.
                </p>
              ) : (
                needs.map((item) => (
                  <Link
                    key={item.title}
                    href={item.href}
                    className="flex gap-3 px-5 py-3 transition hover:bg-secondary/40"
                  >
                    <span className={`w-1 flex-none rounded-full ${item.tone}`} />
                    <span>
                      <span className="block text-sm font-semibold">{item.title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {item.detail}
                      </span>
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
