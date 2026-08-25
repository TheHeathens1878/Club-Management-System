import { redirect } from "next/navigation";

import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { resolveRoleView } from "@/lib/role-view";

/**
 * "Team page" in the parent and coach menus (Adam, 2026-08-25): straight to
 * the team.
 *
 * A redirect, not a page: the team-scoped switcher pick already knows which
 * team; a parent with one child-team or a coach with one team goes there too;
 * only someone with several teams and no scope chosen lands on the list to
 * pick — /family for a parent, /teams for a coach, /my-teams for a player.
 */

export const dynamic = "force-dynamic";

export default async function MyTeamPage() {
  const capabilities = await getCapabilities();
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const scope = await getTeamScope(view, capabilities);

  if (scope) redirect(`/teams/${scope.id}`);
  if (view === "parent" && capabilities.parentTeams.length === 1) {
    redirect(`/teams/${capabilities.parentTeams[0]!.id}`);
  }
  if (view === "player" && capabilities.playerTeams.length === 1) {
    redirect(`/teams/${capabilities.playerTeams[0]!.id}`);
  }
  if (view === "coach" && capabilities.staffTeams.length === 1) {
    redirect(`/teams/${capabilities.staffTeams[0]!.id}`);
  }
  redirect(view === "player" ? "/my-teams" : view === "coach" ? "/teams" : "/family");
}
