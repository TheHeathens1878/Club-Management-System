import { redirect } from "next/navigation";

import { getSessionProfile, isCommittee } from "@/lib/auth";
import { getCapabilities } from "@/lib/capabilities";

/**
 * Who may run a team's own machinery — its Full-Time link above all (Adam,
 * 2026-09-13: "I want coaches to have the ability to post their code snippet
 * in team settings"). Committee sign-ins run every team; a coach, assistant
 * or manager runs the teams `my_capabilities()` lists them as staff of, and
 * nobody else's. Same answer the team page gives before it draws the
 * Settings tab, asked again here because a server action trusts nothing the
 * browser sends.
 */
export async function requireTeamManager(teamId: string) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (isCommittee(session.profile?.role)) return session;
  const capabilities = await getCapabilities();
  if (capabilities.staffTeams.some((team) => team.id === teamId)) return session;
  redirect("/lobby");
}
