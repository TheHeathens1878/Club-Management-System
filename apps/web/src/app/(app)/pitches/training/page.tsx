import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange, ChevronRight, Plus } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";
import { dateSpanLabel } from "@/lib/training-plan";

export const metadata = { title: "Training blocks" };

export const dynamic = "force-dynamic";

/**
 * `/pitches/training` — the club's training blocks (Adam, 2026-09-06:
 * "winter training allocation"). One row per block, the way iOS lists
 * things: a name, its span, how much is planned, and a chevron. The work
 * happens on the block's own page.
 *
 * The guard mirrors /pitches/manage: the committee sign-in or the
 * `person_roles` club_admin — which is also `can_plan_training()`, the
 * predicate every write policy asks.
 */
export default async function TrainingBlocksPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/lobby");

  const supabase = await createClient();
  const { data: blocks, error } = await supabase
    .from("training_blocks")
    .select("id,name,starts_on,ends_on,last_synced_at,training_slots(id,training_allocations(id))")
    .order("starts_on", { ascending: false });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Training blocks"
        subtitle="Winter slots at the 3G venues, shared out between teams and put on every family's calendar"
        back={{ href: "/pitches", label: "Pitches" }}
        action={
          <Link href="/pitches/training/new" className={buttonVariants({ size: "sm" }) + " min-h-[44px] lg:min-h-0"}>
            <Plus className="h-4 w-4" /> New block
          </Link>
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load the blocks: {error.message}
          </p>
        ) : null}

        {(blocks ?? []).length === 0 && !error ? (
          <EmptyState
            icon={CalendarRange}
            title="No training blocks yet"
            action={{ href: "/pitches/training/new", label: "Plan a block" }}
          >
            A block is a run of weekly training — “Winter 2026/27” — with its dates off, the slots at
            each venue, and the teams sharing them. Plan it here, then put it on the calendar in one go.
          </EmptyState>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {(blocks ?? []).map((block) => {
              const slots = block.training_slots ?? [];
              const teams = slots.reduce((sum, slot) => sum + (slot.training_allocations?.length ?? 0), 0);
              const live = block.starts_on <= today && block.ends_on >= today;
              const over = block.ends_on < today;
              return (
                <li key={block.id}>
                  <Link
                    href={`/pitches/training/${block.id}`}
                    className="flex min-h-[60px] items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/50"
                  >
                    <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <CalendarRange className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-medium leading-snug">{block.name}</span>
                        {live ? <Badge variant="success">Running</Badge> : null}
                        {over ? <Badge variant="muted">Finished</Badge> : null}
                        {!block.last_synced_at ? <Badge variant="warning">Not on the calendar yet</Badge> : null}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
                        {dateSpanLabel(block.starts_on, block.ends_on)} · {slots.length} slot
                        {slots.length === 1 ? "" : "s"} · {teams} team place{teams === 1 ? "" : "s"}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
