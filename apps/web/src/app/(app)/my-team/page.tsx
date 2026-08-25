import { redirect } from "next/navigation";

import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { resolveRoleView } from "@/lib/role-view";

/**
 * "Team" in the parent menu (Adam, 2026-08-25): straight to the child's team.
 *
 * A redirect, not a page: the team-scoped switcher pick already knows which
 * team; a parent with one child-team goes there too; only a parent of children
 * on several teams with no scope chosen lands on /family to pick.
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
  redirect(view === "player" ? "/my-teams" : "/family");
}
