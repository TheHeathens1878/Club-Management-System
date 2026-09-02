import { Eye } from "lucide-react";


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
  showLeave = true,
  postFixtures,
  fill = false,
}: {
  data: ThreadData;
  showLeave?: boolean;
  /** Referees group only: offer the "Post a game" composer, with these
      fixtures ready to auto-complete. */
  postFixtures?: FixtureOption[];
  /**
   * The standalone /messages/[id] page, where the thread IS the page: the
   * banner and the referee form hold their height, the conversation takes
   * whatever is left, and the composer sits on the floor of the screen. The
   * team page embeds this panel among other blocks and stays as it was.
   *
   * `lg:flex-none` on each link of the chain matters: above lg the shell has
   * no set height, and a `flex-1` (basis 0) item in an auto-height column
   * measures as nothing — the thread would collapse to a sliver on the desk.
   */
  fill?: boolean;
}) {
  const { conversation, participants, personId, myLive } = data;

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
    <div
      className={
        fill
          ? "flex min-h-0 flex-1 flex-col gap-2 lg:flex-none lg:gap-4"
          : "space-y-4"
      }
    >
      {/* SG-9: persistent and non-dismissible, in every code path — but on a
          phone the full paragraph pushed the conversation off the screen
          (Adam, 2026-08-25). The notice itself stays on every viewport; only
          its explanation is folded away below lg. */}
      {conversation.supervised_by_lead && (
        <div className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 lg:px-4 lg:py-3">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">
              The club&apos;s safeguarding lead can read this conversation.
            </p>
            <p className="mt-0.5 hidden lg:block">
              This conversation is supervised because a young person is taking part without a
              parent or guardian in the room. The safeguarding lead (and a club administrator)
              can open and export everything said here, and every time they do it is recorded.
            </p>
          </div>
        </div>
      )}

      {data.isRefereesGroup && myLive && !conversation.closed_at && (
        <div className="shrink-0">
          <MatchPostComposer conversationId={conversation.id} fixtures={postFixtures ?? []} />
        </div>
      )}

      <ThreadClient
        fill={fill}
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
        refereePersonIds={data.refereePersonIds}
        isRefereesGroup={data.isRefereesGroup}
        isAdmin={data.isClubAdmin}
        isSuperUser={data.isSuperUser}
      />

      {showLeave && myLive && !conversation.closed_at && (
        <LeaveButton conversationId={conversation.id} />
      )}
    </div>
  );
}
