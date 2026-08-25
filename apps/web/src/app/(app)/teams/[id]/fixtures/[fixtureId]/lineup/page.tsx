import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile } from "@/lib/auth";

import { LineupSection, loadLineupSection } from "./lineup-section";

/**
 * One fixture's lineup on its own page (Adam, 2026-08-25: "Within a match
 * event, I want the ability to select a formation and assign players to it").
 *
 * The board itself lives in `lineup-section.tsx`, because the Lineup tab of the
 * Event & RSVP page renders the same thing; this page is the header, the way
 * back, and nothing else.
 *
 * The formations on offer come from the team's playing format, which the FA
 * table derives from `teams.age_group` — a U13 side is shown 9v9 shapes and
 * nothing else. Team staff and club admins get the board; everyone else who
 * may read the lineup (the squad, their parents) gets the same pitch without
 * the controls, so a player can see where they are standing.
 */
export default async function FixtureLineupPage({
  params,
}: {
  params: Promise<{ id: string; fixtureId: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { id: teamId, fixtureId } = await params;
  const data = await loadLineupSection(teamId, fixtureId);
  if (!data) notFound();

  return (
    <>
      <div className="hidden lg:block">
        <PageHeader
          title={`Lineup — ${data.title}`}
          subtitle={`${data.whereLine} · ${data.format}`}
          action={
            <Link
              href={`/teams/${teamId}/fixtures/${fixtureId}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ChevronLeft className="h-4 w-4" /> Back to the fixture
            </Link>
          }
        />
      </div>

      <div className="theme-ink bg-background px-4 pb-4 pt-3 text-foreground lg:hidden">
        <div className="flex items-center gap-2">
          <Link
            href={`/teams/${teamId}/fixtures/${fixtureId}`}
            aria-label="Back to the fixture"
            className="-ml-2 flex h-11 w-9 shrink-0 items-center justify-center text-accent"
          >
            <ChevronLeft className="h-[22px] w-[22px]" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-[10.5px] uppercase tracking-[0.16em] text-foreground/55">
              {data.whereLine}
            </p>
            <h1 className="font-display mt-1 truncate text-[19px] font-semibold uppercase leading-none tracking-wide">
              Lineup
            </h1>
            <p className="mt-1.5 truncate text-[12px] text-foreground/60">
              {data.title} · {data.format}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 lg:p-6">
        <LineupSection data={data} />
      </div>
    </>
  );
}
