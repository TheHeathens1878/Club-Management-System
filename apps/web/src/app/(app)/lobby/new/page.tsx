import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { resolveRoleView } from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";

import { PostForm, type TeamOption } from "./post-form";

/**
 * Compose. The gate here mirrors `create_board_post()` — administrators and
 * team staff; the database is the one that actually refuses.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Post to the lobby" };

export default async function NewLobbyPostPage() {
  const capabilities = await getCapabilities();
  // Adam, 2026-08-25: only admins post to the club noticeboard. Team staff
  // post to their team's lobby from the team page, not from here.
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  if (
    (!capabilities.isClubAdmin && !capabilities.isCommittee) ||
    (view !== "admin" && view !== null)
  ) {
    redirect("/lobby");
  }

  const supabase = await createClient();
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id,name,age_group")
    .order("name");
  const teams: TeamOption[] = (teamRows ?? []).map((team) => ({ id: team.id, name: team.name }));
  const ageGroups = Array.from(
    new Set((teamRows ?? []).map((team) => team.age_group).filter((value): value is string => !!value)),
  ).sort();

  return (
    <>
      <PageHeader
        title="Post to the lobby"
        subtitle="The whole club, every team's board, or just the teams it concerns"
        back={{ href: "/lobby", label: "Club lobby" }}
      />
      <div className="p-4 lg:p-6">
        <PostForm teams={teams} ageGroups={ageGroups} isAdmin={capabilities.isClubAdmin} />
      </div>
    </>
  );
}
