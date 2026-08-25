import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getCapabilities } from "@/lib/capabilities";
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
  if (!capabilities.isClubAdmin && !capabilities.isCommittee && !capabilities.isTeamStaff) {
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
        action={
          <Link
            href="/lobby"
            className={
              buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] lg:min-h-0"
            }
          >
            <ArrowLeft className="h-4 w-4" /> Club lobby
          </Link>
        }
      />
      <div className="p-4 lg:p-6">
        <PostForm teams={teams} ageGroups={ageGroups} isAdmin={capabilities.isClubAdmin} />
      </div>
    </>
  );
}
