import Link from "next/link";
import { Eye } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { getSessionProfile, isCommittee } from "@/lib/auth";

import { LeaveButton } from "./leave-button";
import { MatchPostComposer, type FixtureOption } from "./match-post-composer";
import { ThreadClient } from "./thread-client";
import { MESSAGE_LIMIT, type ThreadData } from "./thread-data";

/**
 * One conversation, rendered — the SG-9 banner, the participant chips and the
 * live thread. Shared by /messages/[id] and the team page's Chat and Notice
 * board tabs, so a thread looks and behaves identically wherever it appears.
 *
 * SAFEGUARDING SG-9: the banner below is persistent and non-dismissible, and
 * there is no code path that renders a supervised thread without it — that is
 * the acceptance criterion, wherever the thread is embedded.
 */
export async function ThreadPanel({
  data,
  showParticipants = true,
  showLeave = true,
  postFixtures,
}: {
  data: ThreadData;
  showParticipants?: boolean;
  showLeave?: boolean;
  /** Referees group only: offer the "Post a game" composer, with these
      fixtures ready to auto-complete. */
  postFixtures?: FixtureOption[];
}) {
  const { conversation, participants, personId, myLive } = data;
  // Adam, 2026-08-25: an admin clicks a member's name and lands on their
  // contact page. /people/[id] admits the committee and nobody else, so the
  // chip is a link on exactly that answer and plain text for everyone else.
  const session = await getSessionProfile();
  const canOpenContacts = isCommittee(session?.profile?.role);

  // Who `@` may name: the people actually in the room now, minus yourself, and
  // minus anyone whose name this reader is not entitled to see ("Club member"
  // is not something to offer as a mention). Deduplicated by person, because
  // someone who left and rejoined has more than one participant row. The
  // server resolves the typed names against the same live set — this list only
  // saves the typing.
  const mentionables = Array.from(
    new Map(
      participants
        .filter((p) => p.left_at === null && p.person_id !== personId)
        .map((p) => [p.person_id, { person_id: p.person_id, name: data.nameMap[p.person_id] ?? "" }]),
    ).values(),
  ).filter((c) => c.name !== "" && c.name !== data.unnamedLabel);

  return (
    <div className="space-y-4">
      {conversation.supervised_by_lead && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">
              The club&apos;s safeguarding lead can read this conversation.
            </p>
            <p className="mt-0.5">
              This conversation is supervised because a young person is taking part without a
              parent or guardian in the room. The safeguarding lead (and a club administrator)
              can open and export everything said here, and every time they do it is recorded.
            </p>
          </div>
        </div>
      )}

      {showParticipants && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>In this conversation:</span>
          {participants.map((p) => {
            const label = `${
              p.person_id === personId ? "You" : (data.nameMap[p.person_id] ?? data.unnamedLabel)
            }${p.left_at ? " (left)" : ""}`;
            const chip = (
              <Badge
                variant={p.left_at ? "muted" : "outline"}
                className={canOpenContacts ? "hover:bg-secondary" : undefined}
              >
                {label}
              </Badge>
            );
            return canOpenContacts ? (
              <Link key={`${p.person_id}-${p.joined_at}`} href={`/people/${p.person_id}`}>
                {chip}
              </Link>
            ) : (
              <span key={`${p.person_id}-${p.joined_at}`}>{chip}</span>
            );
          })}
        </div>
      )}

      {data.isRefereesGroup && myLive && !conversation.closed_at && (
        <MatchPostComposer conversationId={conversation.id} fixtures={postFixtures ?? []} />
      )}

      <ThreadClient
        conversationId={conversation.id}
        conversationType={conversation.type}
        myPersonId={personId}
        myName={data.myName}
        myLastReadId={myLive?.last_read_message_id ?? null}
        initialMessages={data.messages}
        initialReactions={data.reactions}
        initialAttachments={data.attachments}
        initialReaders={data.readers}
        hasEarlier={data.messages.length === MESSAGE_LIMIT}
        names={data.nameMap}
        canPost={!!myLive && !conversation.closed_at && !data.announcementReadOnly}
        canReact={!!myLive && !conversation.closed_at && conversation.type !== "announcement"}
        readOnlyNotice={data.readOnlyNotice}
        mentionables={mentionables}
        matchPosts={data.matchPosts}
        isReferee={data.isReferee}
        isRefereesGroup={data.isRefereesGroup}
        isAdmin={data.isClubAdmin}
      />

      {showLeave && myLive && !conversation.closed_at && (
        <LeaveButton conversationId={conversation.id} />
      )}
    </div>
  );
}
