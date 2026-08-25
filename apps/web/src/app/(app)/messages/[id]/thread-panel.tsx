import { Eye } from "lucide-react";

import { Badge } from "@/components/ui/badge";

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
export function ThreadPanel({
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
          {participants.map((p) => (
            <Badge key={`${p.person_id}-${p.joined_at}`} variant={p.left_at ? "muted" : "outline"}>
              {p.person_id === personId ? "You" : (data.nameMap[p.person_id] ?? data.unnamedLabel)}
              {p.left_at ? " (left)" : ""}
            </Badge>
          ))}
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
