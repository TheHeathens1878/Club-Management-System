import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";

/**
 * "Referee" in the switcher (Adam, 2026-08-25: "I should also be able to
 * switch role to see referee and associated data (primarily the referees
 * group)").
 *
 * A redirect, not a page: the referees group IS the referee's screen — games
 * are posted there as cards and claimed there — so this resolves the seeded
 * group and goes. `referees_group_id()` is SECURITY DEFINER and answers for
 * anybody; the conversation itself is still gated by
 * `conversations_participant_read`, so a referee who has somehow been left out
 * of the group lands on the messages list rather than on a thread the database
 * would refuse them.
 */

export const dynamic = "force-dynamic";

export default async function RefereePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const { data: groupId } = await supabase.rpc("referees_group_id");
  if (!groupId) redirect("/messages");

  const { data: participant } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("conversation_id", groupId)
    .is("left_at", null)
    .maybeSingle();

  redirect(participant ? `/messages/${groupId}` : "/messages");
}
