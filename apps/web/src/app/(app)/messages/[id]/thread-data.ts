import { getSessionProfile, isSuperUser } from "@/lib/auth";
import { getCurrentPersonId, isClubAdmin, nameOf, resolveNames, UNNAMED } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import type {
  ReaderRow,
  ThreadAttachment,
  ThreadMessage,
  ThreadReaction,
} from "./thread-client";

/**
 * Everything one conversation view needs, assembled once — used by
 * /messages/[id] and by the team page's Chat and Notice board tabs, so the
 * two can never disagree about what a thread shows or who may post.
 *
 * USER-SCOPED client throughout: the caller sees this conversation because
 * the P5.2 participant policies say so, and for no other reason. `null` means
 * "not yours to see" — the conversation does not exist, or the caller was
 * never a participant. There is deliberately no admin bypass here (SG-9:
 * oversight reads live in /safeguarding and are audited).
 */

/** The visible tail of a thread; older messages page in on demand. */
export const MESSAGE_LIMIT = 200;

export type ThreadData = {
  conversation: {
    id: string;
    type: string;
    title: string | null;
    team_id: string | null;
    supervised_by_lead: boolean;
    closed_at: string | null;
    created_by_person_id: string | null;
  };
  personId: string;
  myName: string;
  myLive: { last_read_message_id: string | null } | null;
  participants: {
    person_id: string;
    basis: string;
    left_at: string | null;
    joined_at: string;
    last_read_message_id: string | null;
  }[];
  messages: ThreadMessage[];
  reactions: ThreadReaction[];
  attachments: ThreadAttachment[];
  readers: ReaderRow[];
  nameMap: Record<string, string>;
  title: string;
  announcementReadOnly: boolean;
  readOnlyNotice: string | null;
  canManageGroup: boolean;
  unnamedLabel: string;
  /** The Referees group's claimable game cards, keyed by message id. */
  matchPosts: Record<string, MatchPostView>;
  /** The caller holds the referee hat — may claim a posted game. */
  isReferee: boolean;
  /**
   * Everybody in this room who holds it, so a post can say so (Adam,
   * 2026-09-02). Not the same question as `isReferee`, and not answerable from
   * `person_roles` by an ordinary member — see `conversation_referees()`.
   */
  refereePersonIds: string[];
  /** This is the seeded Referees group, where games are posted. */
  isRefereesGroup: boolean;
  /** The caller is a club admin — may release any claimed game. */
  isClubAdmin: boolean;
  /** The club owner: the only person offered a permanent delete (SG-2). */
  isSuperUser: boolean;
};

/** One "game needs a referee" card, serialisable for the client thread. */
export type MatchPostView = {
  id: string;
  fixtureText: string;
  durationText: string | null;
  formatText: string | null;
  locationText: string | null;
  surface: string | null;
  kickoffAt: string | null;
  feeText: string | null;
  claimedByName: string | null;
  /** For the Release button: the guard admits the claimer, the poster, or an admin. */
  claimedByPersonId: string | null;
  postedByPersonId: string;
};

export async function loadThread(conversationId: string): Promise<ThreadData | null> {
  const session = await getSessionProfile();
  if (!session) return null;
  const personId = await getCurrentPersonId();
  if (!personId) return null;

  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id,type,title,team_id,supervised_by_lead,closed_at,created_by_person_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return null;

  const [{ data: participantRows }, { data: messageRows }] = await Promise.all([
    supabase
      .from("conversation_participants")
      .select("person_id,basis,left_at,joined_at,last_read_message_id")
      .eq("conversation_id", conversationId),
    supabase
      .from("messages")
      .select("id,body,created_at,sender_person_id,deleted_at,redacted_at,reply_to_id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_LIMIT),
  ]);

  const participants = participantRows ?? [];
  const mine = participants.filter((p) => p.person_id === personId);
  if (mine.length === 0) return null;
  const myLive = mine.find((p) => p.left_at === null) ?? null;

  const messages: ThreadMessage[] = (messageRows ?? []).slice().reverse();
  const messageIds = messages.map((m) => m.id);
  const isRefereesGroup = conversation.type === "group" && conversation.title === "Referees";
  const [{ data: reactionRows }, { data: attachmentRows }, { data: matchPostRows }, refereeRole] =
    await Promise.all([
      messageIds.length > 0
        ? supabase
            .from("message_reactions")
            .select("id,message_id,person_id,emoji")
            .in("message_id", messageIds)
        : Promise.resolve({ data: [] }),
      messageIds.length > 0
        ? supabase
            .from("message_attachments")
            .select("id,message_id,storage_bucket,storage_path,content_type")
            .in("message_id", messageIds)
        : Promise.resolve({ data: [] }),
      isRefereesGroup && messageIds.length > 0
        ? supabase
            .from("referee_match_posts")
            .select(
              "id,message_id,fixture_text,duration_text,format_text,location_text,surface,kickoff_at,fee_text,claimed_by_person_id,posted_by_person_id",
            )
            .in("message_id", messageIds)
        : Promise.resolve({ data: [] }),
      // The caller's own hat, read through their own person_roles rows.
      supabase
        .from("person_roles")
        .select("id")
        .eq("person_id", personId)
        .eq("role", "referee")
        .is("revoked_at", null)
        .limit(1)
        .maybeSingle(),
    ]);

  // And everybody else's, for the badge beside a post. Adam, 2026-09-02: "I
  // also want it to show when they post." A member cannot read anybody's
  // `person_roles` but their own, so this is the accessor's job
  // (`conversation_referees()`, 20260902130000) — scoped to this room, and
  // answering only because the caller is already in it.
  const { data: refereeIds } = await supabase.rpc("conversation_referees", {
    p_conversation_id: conversationId,
  });

  const names = await resolveNames([
    ...participants.map((p) => p.person_id),
    ...messages.map((m) => m.sender_person_id),
    ...(matchPostRows ?? [])
      .map((row) => row.claimed_by_person_id)
      .filter((id): id is string => !!id),
  ]);
  const nameMap: Record<string, string> = {};
  for (const p of participants) nameMap[p.person_id] = nameOf(names, p.person_id);
  for (const m of messages) nameMap[m.sender_person_id] = nameOf(names, m.sender_person_id);

  const activeOthers = participants.filter(
    (p) => p.left_at === null && p.person_id !== personId,
  );
  const isStaffHere = myLive ? myLive.basis === "staff" || myLive.basis === "creator" : false;
  const announcementReadOnly = conversation.type === "announcement" && !isStaffHere;

  const readOnlyNotice = conversation.closed_at
    ? "This conversation is closed. Its history is kept, but nothing new can be posted."
    : !myLive
      ? "You have left this conversation. You can still read what was said while you were in it."
      : announcementReadOnly
        ? "Announcements are one-way. Only team staff can post here."
        : null;

  const canManageGroup =
    conversation.type === "group" &&
    (conversation.created_by_person_id === personId || (await isClubAdmin()));

  const title =
    conversation.title ||
    (activeOthers.length > 0
      ? activeOthers.map((p) => nameOf(names, p.person_id)).join(", ")
      : conversation.type === "announcement"
        ? "Announcements"
        : "Conversation");

  return {
    conversation,
    personId,
    myName: session.profile?.full_name || "Someone",
    myLive,
    participants,
    messages,
    reactions: (reactionRows ?? []) as ThreadReaction[],
    attachments: (attachmentRows ?? []) as ThreadAttachment[],
    readers: activeOthers.map((p) => ({
      person_id: p.person_id,
      last_read_message_id: p.last_read_message_id,
    })),
    nameMap,
    title,
    announcementReadOnly,
    readOnlyNotice,
    canManageGroup,
    unnamedLabel: UNNAMED,
    matchPosts: Object.fromEntries(
      (matchPostRows ?? []).map((row) => [
        row.message_id,
        {
          id: row.id,
          fixtureText: row.fixture_text,
          durationText: row.duration_text,
          formatText: row.format_text,
          locationText: row.location_text,
          surface: row.surface,
          kickoffAt: row.kickoff_at,
          feeText: row.fee_text,
          claimedByName: row.claimed_by_person_id
            ? nameOf(names, row.claimed_by_person_id)
            : null,
          claimedByPersonId: row.claimed_by_person_id,
          postedByPersonId: row.posted_by_person_id,
        },
      ]),
    ),
    isReferee: !!refereeRole.data,
    /** Everybody in this room who holds the referee hat — the badge on a post. */
    refereePersonIds: (refereeIds ?? []) as string[],
    isRefereesGroup,
    isClubAdmin: await isClubAdmin(),
    isSuperUser: isSuperUser(session.profile?.role),
  };
}
