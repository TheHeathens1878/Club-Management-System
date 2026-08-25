"use server";

/**
 * The Referees group's two writes (Adam, 2026-08-25).
 *
 *   · `postMatchGame` — a coach posts a game that needs a referee: one message
 *     (its body is the plain-text fallback of the card) plus one
 *     `referee_match_posts` row keyed by the message id, the attachments
 *     pattern. USER-SCOPED throughout: the participant policies decide who may
 *     post, and the messaging guards still apply.
 *   · `claimMatchGame` — a referee claims it. The update runs as the caller
 *     (RLS + the guard trigger are the arbiters: unclaimed, self, referee hat),
 *     then a follow-up message says who got the game and the ADMIN client
 *     notifies the poster with the referee's contact details from their record
 *     — notify() is service-role-only by design.
 */

import { revalidatePath } from "next/cache";

import { getCurrentPersonId } from "@/lib/person";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type RefereeActionState = { error?: string; notice?: string };

const SURFACES = ["3G", "Grass"] as const;

export async function postMatchGame(
  _prev: RefereeActionState,
  formData: FormData,
): Promise<RefereeActionState> {
  const personId = await getCurrentPersonId();
  if (!personId) return { error: "Your sign-in is not linked to a member record." };

  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const fixtureId = String(formData.get("fixture_id") ?? "").trim() || null;
  const fixtureText = String(formData.get("fixture_text") ?? "").trim();
  const durationText = String(formData.get("duration_text") ?? "").trim() || null;
  const formatText = String(formData.get("format_text") ?? "").trim() || null;
  const locationText = String(formData.get("location_text") ?? "").trim() || null;
  const surfaceInput = String(formData.get("surface") ?? "").trim();
  const surface = (SURFACES as readonly string[]).includes(surfaceInput) ? surfaceInput : null;
  const date = String(formData.get("kickoff_date") ?? "").trim();
  const time = String(formData.get("kickoff_time") ?? "").trim();
  const feeText = String(formData.get("fee_text") ?? "").trim() || null;

  if (!conversationId) return { error: "Missing conversation." };
  if (!fixtureText) return { error: "Say which fixture needs a referee (include the age group)." };

  let kickoffAt: string | null = null;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)) {
    // Europe/London wall clock, the club's convention throughout.
    const probe = new Date(`${date}T${time}:00Z`);
    const londonOffsetMinutes =
      (new Date(probe.toLocaleString("en-US", { timeZone: "Europe/London" })).getTime() -
        new Date(probe.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) /
      60000;
    kickoffAt = new Date(probe.getTime() - londonOffsetMinutes * 60000).toISOString();
  }

  const whenLine =
    date && time
      ? `${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}, ${time} KO`
      : null;

  // The message body is the card's plain-text fallback — what notifications,
  // previews and any client without the card table still show.
  const body = [
    `Referee needed — ${fixtureText}`,
    [durationText, formatText].filter(Boolean).join(" · ") || null,
    locationText,
    surface,
    whenLine,
    feeText,
  ]
    .filter(Boolean)
    .join("\n");

  const supabase = await createClient();
  const messageId = crypto.randomUUID();
  const { error: messageError } = await supabase.from("messages").insert({
    id: messageId,
    conversation_id: conversationId,
    sender_person_id: personId,
    body,
  });
  if (messageError) return { error: messageError.message };

  const { error: postError } = await supabase.from("referee_match_posts").insert({
    message_id: messageId,
    conversation_id: conversationId,
    posted_by_person_id: personId,
    fixture_id: fixtureId,
    fixture_text: fixtureText,
    duration_text: durationText,
    format_text: formatText,
    location_text: locationText,
    surface,
    kickoff_at: kickoffAt,
    fee_text: feeText,
  });
  if (postError) return { error: postError.message };

  revalidatePath(`/messages/${conversationId}`);
  return { notice: "Game posted to the referees." };
}

export async function claimMatchGame(
  _prev: RefereeActionState,
  formData: FormData,
): Promise<RefereeActionState> {
  const personId = await getCurrentPersonId();
  if (!personId) return { error: "Your sign-in is not linked to a member record." };

  const postId = String(formData.get("post_id") ?? "").trim();
  if (!postId) return { error: "Missing game." };

  // The claim itself, as the caller: RLS admits participants, and the guard
  // trigger is what insists on unclaimed + self + the referee hat.
  const supabase = await createClient();
  const { data: claimedRows, error } = await supabase
    .from("referee_match_posts")
    .update({ claimed_by_person_id: personId, claimed_at: new Date().toISOString() })
    .eq("id", postId)
    .is("claimed_by_person_id", null)
    .select("id,conversation_id,fixture_text,posted_by_person_id");
  if (error) return { error: error.message };
  const claimed = claimedRows?.[0];
  if (!claimed) return { error: "That game has already been claimed." };

  // Who am I, on the record — the poster gets these details.
  const admin = createAdminClient();
  const { data: me } = await admin
    .from("people")
    .select("first_name,last_name,preferred_name,email,phone")
    .eq("id", personId)
    .maybeSingle();
  const myName = me
    ? `${me.preferred_name || me.first_name} ${me.last_name}`.trim()
    : "A referee";

  // The follow-up message everyone in the group sees, sent as the claimer.
  await supabase.from("messages").insert({
    conversation_id: claimed.conversation_id,
    sender_person_id: personId,
    body: `Referee obtained — ${myName}`,
  });

  // And the poster's notification with the referee's contact details, straight
  // from their record. notify() is service-role-only, hence the admin client.
  const contact = [me?.email, me?.phone].filter(Boolean).join(" · ") || "no contact details on record";
  await admin.rpc("notify", {
    p_person_id: claimed.posted_by_person_id,
    p_subject: `Referee found: ${claimed.fixture_text}`,
    p_body: `${myName} has claimed the game. Contact: ${contact}.`,
    p_link: `/messages/${claimed.conversation_id}`,
    p_entity: "referee_match_posts",
    p_entity_id: claimed.id,
  });

  revalidatePath(`/messages/${claimed.conversation_id}`);
  return { notice: "Game claimed — the poster has your contact details." };
}
