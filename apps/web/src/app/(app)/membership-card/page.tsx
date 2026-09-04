import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities } from "@/lib/capabilities";
import { formatCardRef } from "@/lib/finance";
import { createClient } from "@/lib/supabase/server";

/**
 * The electronic membership card (Adam, 2026-09-04): the household number,
 * one card per person under it — 00002A for the lead, B, C, D for the family.
 * Everyone sees their own card; the household sees each other's, because RLS
 * already says a household reads its own account.
 */
export default async function MembershipCardPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const capabilities = await getCapabilities();

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("billing_account_people")
    .select("person_id,letter,removed_at,billing_accounts(member_no,status,lead_person_id),people(first_name,last_name)")
    .is("removed_at", null)
    .order("letter");

  const cards = (rows ?? [])
    .filter((row) => row.billing_accounts && row.people)
    .map((row) => ({
      personId: row.person_id,
      name: `${row.people!.first_name} ${row.people!.last_name}`,
      ref: formatCardRef(row.billing_accounts!.member_no, row.letter),
      isLead: row.billing_accounts!.lead_person_id === row.person_id,
      accountStatus: row.billing_accounts!.status,
      mine: row.person_id === capabilities.personId,
    }))
    .sort((a, b) => (a.mine === b.mine ? a.ref.localeCompare(b.ref) : a.mine ? -1 : 1));

  return (
    <>
      <PageHeader title="Membership card" subtitle="Your electronic membership" />
      <div className="space-y-4 p-4 lg:p-6">
        {cards.length === 0 && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No membership number has been issued to you yet. The club issues numbers when
              memberships are set up — check back soon.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <div
              key={card.personId}
              className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary via-primary/90 to-primary/70 p-5 text-primary-foreground shadow-md"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider opacity-80">AoM Sports Club</p>
                  <p className="mt-0.5 text-sm opacity-90">Member{card.isLead ? " · Lead" : ""}</p>
                </div>
                {card.accountStatus !== "active" && (
                  <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs">{card.accountStatus}</span>
                )}
              </div>
              <p className="mt-6 font-mono text-3xl font-bold tracking-widest tabular-nums">{card.ref}</p>
              <p className="mt-4 truncate text-lg font-semibold">{card.name}</p>
              {card.mine && <p className="text-xs opacity-80">This is your card</p>}
              <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
              <div className="pointer-events-none absolute -bottom-10 -right-2 h-24 w-24 rounded-full bg-white/10" />
            </div>
          ))}
        </div>

        {cards.length > 1 && (
          <p className="text-xs text-muted-foreground">
            Everyone under your membership shares the number — the letter is theirs alone.
          </p>
        )}
      </div>
    </>
  );
}
