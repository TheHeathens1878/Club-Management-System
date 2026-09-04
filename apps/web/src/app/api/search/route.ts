import { NextRequest, NextResponse } from "next/server";

import { getSessionProfile } from "@/lib/auth";
import { getCapabilities } from "@/lib/capabilities";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export type SearchHit = {
  type: "person" | "team";
  label: string;
  detail: string | null;
  href: string;
};

/**
 * The command palette's remote half (2026-09-04 audit: "there is no way to
 * reach anything without knowing which of ~36 menu rows it hides under").
 * Everything reads through the CALLER'S OWN client, so RLS decides what a
 * name search can see — an administrator finds anyone, a member finds their
 * own household and nothing else. Results only link where the caller's own
 * guards will let them land.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionProfile();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const capabilities = await getCapabilities();
  const supabase = await createClient();
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const hits: SearchHit[] = [];

  // People: only for callers whose menus can open a person record.
  if (capabilities.isClubAdmin || capabilities.isCommittee || capabilities.hasFinanceRole) {
    const { data: people } = await supabase
      .from("people")
      .select("id,first_name,last_name,email")
      .is("deleted_at", null)
      .or(`first_name.ilike.${like},last_name.ilike.${like}`)
      .order("last_name")
      .limit(8);
    for (const person of people ?? []) {
      hits.push({
        type: "person",
        label: `${person.first_name} ${person.last_name}`,
        detail: person.email,
        href: `/people/${person.id}`,
      });
    }
  }

  // Teams: staff and admins land on the team page; everyone else's team lives
  // behind /my-team, which the pages section already offers.
  if (capabilities.isClubAdmin || capabilities.isCommittee || capabilities.isTeamStaff) {
    const { data: teams } = await supabase
      .from("teams")
      .select("id,name,age_group")
      .eq("active", true)
      .ilike("name", like)
      .order("name")
      .limit(5);
    for (const team of teams ?? []) {
      hits.push({
        type: "team",
        label: team.name,
        detail: team.age_group,
        href: `/teams/${team.id}`,
      });
    }
  }

  return NextResponse.json({ hits });
}
