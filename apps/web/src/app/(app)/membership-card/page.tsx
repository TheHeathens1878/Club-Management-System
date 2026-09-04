import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { cardColourway, cardValidity, formatCardRef } from "@/lib/finance";
import { resolveRoleView } from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Membership card" };

type CardView = {
  personId: string;
  name: string;
  ref: string;
  isLead: boolean;
  accountStatus: string;
  mine: boolean;
};

/**
 * The electronic membership card — scoped to the HAT, not just the capability
 * (Adam, 2026-09-04: "When I view as me (not admin) I can see everybody's
 * membership card. Me — just mine and sub-members. Coach — those in their
 * team(s). Parent — just mine and sub-members.")
 *
 * RLS alone is not the scope here, deliberately: a club administrator's
 * finance read spans every account, but an administrator wearing the Me hat
 * is a member like any other. So the DATA READ follows the resolved view:
 * every view gets the caller's own household; the coach view adds
 * `team_player_cards()` (each squad's cards, from a definer function that
 * answers only team staff); only the admin view keeps the whole registry.
 */
export default async function MembershipCardPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const capabilities = await getCapabilities();
  const view = resolveRoleView(await getStoredRoleView(), capabilities);

  const supabase = await createClient();
  const [{ data: rows }, { data: season }] = await Promise.all([
    supabase
      .from("billing_account_people")
      .select("account_id,person_id,letter,removed_at,billing_accounts(member_no,status,lead_person_id),people(first_name,last_name)")
      .is("removed_at", null)
      .order("letter"),
    supabase
      .from("seasons")
      .select("name,starts_on,ends_on")
      .eq("is_current", true)
      .maybeSingle(),
  ]);

  // The membership year on the face of the card, and this year's colourway —
  // rotated on the year the membership year starts (1 July), so next season's
  // card is unmistakably different at the door (Adam, 2026-09-04).
  const seasonStartYear = season ? new Date(season.starts_on).getFullYear() : new Date().getFullYear();
  const colourway = cardColourway(seasonStartYear);
  const validity = season ? cardValidity(season.starts_on, season.ends_on) : null;

  const allCards: (CardView & { accountId: string })[] = (rows ?? [])
    .filter((row) => row.billing_accounts && row.people)
    .map((row) => ({
      accountId: row.account_id,
      personId: row.person_id,
      name: `${row.people!.first_name} ${row.people!.last_name}`,
      ref: formatCardRef(row.billing_accounts!.member_no, row.letter),
      isLead: row.billing_accounts!.lead_person_id === row.person_id,
      accountStatus: row.billing_accounts!.status,
      mine: row.person_id === capabilities.personId,
    }));

  // Mine and my sub-members: the household whose number I am under.
  const myAccountId = allCards.find((card) => card.mine)?.accountId ?? null;
  const household = allCards
    .filter((card) => card.accountId === myAccountId && myAccountId !== null)
    .sort((a, b) => (a.mine === b.mine ? a.ref.localeCompare(b.ref) : a.mine ? -1 : 1));

  // The admin hat keeps the registry; every other hat sees its own household.
  const cards = view === "admin" ? allCards.sort((a, b) => a.ref.localeCompare(b.ref)) : household;

  // The coach hat adds each squad's cards, through the definer function that
  // answers only team staff — never billing detail, just number and name.
  const { data: teamCards } =
    view === "coach" ? await supabase.rpc("team_player_cards") : { data: null };
  const squads = new Map<string, { team: string; players: { personId: string; name: string; ref: string }[] }>();
  for (const row of teamCards ?? []) {
    const entry = squads.get(row.team_id) ?? { team: row.team_name, players: [] };
    entry.players.push({ personId: row.person_id, name: `${row.first_name} ${row.last_name}`, ref: row.card_ref });
    squads.set(row.team_id, entry);
  }

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
              className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 text-white shadow-md ${colourway}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider opacity-80">AoM Sports Club</p>
                  <p className="mt-0.5 text-sm opacity-90">
                    Member{card.isLead ? " · Lead" : ""}
                    {season ? ` · ${season.name}` : ""}
                  </p>
                </div>
                {card.accountStatus !== "active" && (
                  <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs">{card.accountStatus}</span>
                )}
              </div>
              <p className="mt-6 font-mono text-3xl font-bold tracking-widest tabular-nums">{card.ref}</p>
              <p className="mt-4 truncate text-lg font-semibold">{card.name}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                {validity ? <p className="text-xs opacity-90">Valid {validity}</p> : <span />}
                {card.mine && <p className="text-xs opacity-80">This is your card</p>}
              </div>
              <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
              <div className="pointer-events-none absolute -bottom-10 -right-2 h-24 w-24 rounded-full bg-white/10" />
            </div>
          ))}
        </div>

        {household.length > 1 && view !== "admin" && (
          <p className="text-xs text-muted-foreground">
            Everyone under your membership shares the number — the letter is theirs alone.
          </p>
        )}

        {view === "coach" &&
          [...squads.values()].map((squad) => (
            <Card key={squad.team}>
              <CardContent className="p-4 lg:p-6">
                <p className="mb-2 text-sm font-medium">{squad.team}</p>
                {squad.players.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No membership numbers issued yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {squad.players.map((player) => (
                      <li key={player.personId} className="flex items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{player.ref}</span>
                        <span>{player.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        {view === "coach" && squads.size === 0 && (
          <p className="text-sm text-muted-foreground">
            None of your squads&apos; players have membership numbers yet.
          </p>
        )}
      </div>
    </>
  );
}
