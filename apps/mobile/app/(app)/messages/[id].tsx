import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Loading } from "../../../components/loading";
import { Banner, Button, Notice, Pill } from "../../../components/ui";
import {
  pickImage,
  uploadAttachment,
  type PickedImage,
} from "../../../lib/attachments";
import { useAuth } from "../../../lib/auth-context";
import { useHouseholdContext } from "../../../lib/household-context";
import {
  clockLabelLondon,
  conversationTitle,
  dayKeyLondon,
  dayLabelLondon,
  isReadByAllOthers,
  isUsableReportReason,
  isWithdrawn,
  lastReadAtByPerson,
  messageBody,
  reactionChips,
  SUPERVISED_BANNER,
  type MessageRow,
  type ReactionChip,
} from "../../../lib/messaging";
import { theme } from "../../../lib/theme";
import { useThread, type ThreadAttachment } from "../../../lib/use-thread";

/**
 * One conversation.
 *
 * SAFEGUARDING SG-9 — the banner. A conversation flagged `supervised_by_lead`
 * carries a persistent, non-dismissible banner telling every participant that
 * the club's safeguarding lead can read and export it. It is rendered above
 * the messages, before anything else on the screen, and there is no code path
 * that hides it while the flag is set. That is the P6.3 acceptance criterion,
 * and the spec is explicit that a monitored conversation without the banner is
 * a defect rather than a cosmetic issue.
 */
export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = typeof id === "string" ? id : null;

  const { session } = useAuth();
  const household = useHouseholdContext();
  const myPersonId = household.data?.personId ?? null;

  // `messages.deleted_by` references auth.users, not people.
  const thread = useThread(conversationId, myPersonId, session?.user.id);

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PickedImage | null>(null);
  /** Message id being reported, and the reason typed for it. */
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  /** Message the composer is replying to (WhatsApp-style quote). */
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  /** Message whose long-press action sheet is open. */
  const [actionsFor, setActionsFor] = useState<MessageRow | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // ✓✓ ticks: what every other active participant has read, live.
  const readState = useMemo(
    () => lastReadAtByPerson(thread.readers, thread.messages, myPersonId),
    [thread.readers, thread.messages, myPersonId],
  );
  const messageById = useMemo(
    () => new Map(thread.messages.map((message) => [message.id, message])),
    [thread.messages],
  );

  const title = useMemo(() => {
    if (!thread.conversation) return "Conversation";
    const others = Object.entries(thread.names)
      .filter(([personId]) => personId !== myPersonId)
      .map(([, name]) => name);
    return conversationTitle(thread.conversation, others);
  }, [thread.conversation, thread.names, myPersonId]);

  if (!conversationId) {
    return <Notice tone="error">That conversation link is not valid.</Notice>;
  }

  if (thread.loading && thread.messages.length === 0) {
    return <Loading label="Opening conversation…" />;
  }

  // Only a conversation we have actually loaded can be closed; a null one is
  // still loading, and hiding the composer for it would look like a lockout.
  const closed = Boolean(thread.conversation?.closed_at);

  async function attachImage() {
    const result = await pickImage();
    if (result.ok) {
      setPending(result.image);
      return;
    }
    if (!result.cancelled) Alert.alert("Cannot attach that", result.error);
  }

  async function send() {
    // Captured, not asserted: the upload closure runs after an await, and
    // TypeScript cannot see the early return above from inside it.
    const target = conversationId;
    if (!target) return;

    const image = pending;
    const body = draft;
    if (!body.trim() && !image) return;

    setDraft("");
    setPending(null);

    const reply = replyTo;
    setReplyTo(null);

    const sent = await thread.send(
      body,
      image
        ? async (messageId) => {
            const upload = await uploadAttachment(target, messageId, image);
            return upload.ok
              ? { ok: true }
              : { ok: false, error: upload.error };
          }
        : undefined,
      reply?.id ?? null,
    );

    if (!sent) {
      // Put the draft back rather than losing what someone typed.
      setDraft(body);
      setPending(image);
      setReplyTo(reply);
      return;
    }
    scrollRef.current?.scrollToEnd({ animated: true });
  }

  function confirmDelete(messageId: string) {
    Alert.alert(
      "Delete message",
      "It is removed for everyone, but the club's safeguarding record keeps a copy.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void thread.softDelete(messageId);
          },
        },
      ],
    );
  }

  async function submitReport() {
    if (!reporting) return;
    // `report_message()` rejects a blank reason, and rightly: the reason is
    // what the safeguarding lead triages on.
    if (!isUsableReportReason(reason)) {
      Alert.alert(
        "A reason is needed",
        "Tell the safeguarding lead why you are reporting this message.",
      );
      return;
    }

    const ok = await thread.report(reporting, reason);
    setReporting(null);
    setReason("");
    if (ok) {
      Alert.alert("Reported", "The club's safeguarding lead has been told.");
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
    >
      <Stack.Screen options={{ title }} />

      {/* SG-9: persistent, never dismissible, above the messages. */}
      {thread.conversation?.supervised_by_lead ? (
        <View style={styles.bannerWrap}>
          <Banner title="Safeguarding oversight">{SUPERVISED_BANNER}</Banner>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.messages}
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: false })
        }
      >
        {thread.error ? <Notice tone="error">{thread.error}</Notice> : null}

        {thread.messages.length === 0 && !thread.error ? (
          <Notice>No messages yet. Say hello.</Notice>
        ) : null}

        {thread.messages.map((message, index) => {
          const prev = index > 0 ? thread.messages[index - 1] : null;
          const newDay =
            !prev || dayKeyLondon(prev.created_at) !== dayKeyLondon(message.created_at);
          const quoted = message.reply_to_id
            ? (messageById.get(message.reply_to_id) ?? null)
            : null;
          return (
            <View key={message.id}>
              {newDay ? (
                <View style={styles.dayChipWrap}>
                  <Text style={styles.dayChip}>{dayLabelLondon(message.created_at)}</Text>
                </View>
              ) : null}
              <MessageBubble
                message={message}
                mine={message.sender_person_id === myPersonId}
                senderName={thread.names[message.sender_person_id] ?? "A club member"}
                quoted={quoted}
                quotedName={
                  quoted
                    ? quoted.sender_person_id === myPersonId
                      ? "You"
                      : (thread.names[quoted.sender_person_id] ?? "A club member")
                    : null
                }
                hasUnrenderedQuote={Boolean(message.reply_to_id) && !quoted}
                chips={reactionChips(thread.reactions, message.id, myPersonId)}
                readByAll={isReadByAllOthers(message, readState.otherIds, readState.readAt)}
                attachments={thread.attachments.filter(
                  (attachment) => attachment.messageId === message.id,
                )}
                onToggleReaction={(emoji) => {
                  void thread.toggleReaction(message.id, emoji);
                }}
                onLongPress={() => setActionsFor(message)}
              />
            </View>
          );
        })}

        {thread.attachmentsUnreadable ? (
          <Notice>
            One or more photos cannot be shown on this device yet — the
            attachments bucket has no read policy for members. The club has been
            told; the images are stored safely.
          </Notice>
        ) : null}
      </ScrollView>

      {closed ? (
        <View style={styles.composer}>
          <Notice>This conversation is closed. Nothing more can be sent.</Notice>
        </View>
      ) : (
        <View style={styles.composer}>
          {replyTo ? (
            <View style={styles.replyBar}>
              <View style={styles.replyBarText}>
                <Text style={styles.replyBarName}>
                  Replying to{" "}
                  {replyTo.sender_person_id === myPersonId
                    ? "yourself"
                    : (thread.names[replyTo.sender_person_id] ?? "A club member")}
                </Text>
                <Text style={styles.replyBarBody} numberOfLines={1}>
                  {messageBody(replyTo)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
                onPress={() => setReplyTo(null)}
              >
                <Text style={styles.pendingRemove}>Cancel</Text>
              </Pressable>
            </View>
          ) : null}

          {pending ? (
            <View style={styles.pending}>
              <Text style={styles.pendingText} numberOfLines={1}>
                📎 {pending.fileName}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPending(null)}
              >
                <Text style={styles.pendingRemove}>Remove</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.composerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach a photo"
              onPress={() => {
                void attachImage();
              }}
              style={styles.attach}
            >
              <Text style={styles.attachGlyph}>📎</Text>
            </Pressable>

            <TextInput
              style={styles.input}
              placeholder="Message"
              placeholderTextColor={theme.colour.muted}
              value={draft}
              onChangeText={setDraft}
              multiline
            />

            <View style={styles.sendWrap}>
              <Button
                title="Send"
                busy={thread.sending}
                disabled={!draft.trim() && !pending}
                onPress={() => {
                  void send();
                }}
              />
            </View>
          </View>
        </View>
      )}

      {/* Long-press action sheet: react / reply / delete / report. */}
      <Modal
        visible={actionsFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActionsFor(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setActionsFor(null)}>
          <View style={styles.modalCard}>
            {actionsFor && !isWithdrawn(actionsFor) && !closed ? (
              <View style={styles.emojiRow}>
                {QUICK_EMOJI.map((emoji) => (
                  <Pressable
                    key={emoji}
                    accessibilityRole="button"
                    accessibilityLabel={`React ${emoji}`}
                    onPress={() => {
                      const target = actionsFor;
                      setActionsFor(null);
                      if (target) void thread.toggleReaction(target.id, emoji);
                    }}
                    style={styles.emojiButton}
                  >
                    <Text style={styles.emojiGlyph}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {actionsFor && !isWithdrawn(actionsFor) && !closed ? (
              <Button
                title="Reply"
                variant="secondary"
                onPress={() => {
                  setReplyTo(actionsFor);
                  setActionsFor(null);
                }}
              />
            ) : null}
            {actionsFor &&
            !isWithdrawn(actionsFor) &&
            actionsFor.sender_person_id === myPersonId ? (
              <Button
                title="Delete for everyone"
                variant="secondary"
                onPress={() => {
                  const target = actionsFor;
                  setActionsFor(null);
                  if (target) confirmDelete(target.id);
                }}
              />
            ) : null}
            {actionsFor && !isWithdrawn(actionsFor) ? (
              <Button
                title="Report to the safeguarding lead"
                variant="secondary"
                onPress={() => {
                  const target = actionsFor;
                  setActionsFor(null);
                  if (target) {
                    setReason("");
                    setReporting(target.id);
                  }
                }}
              />
            ) : null}
            <Button title="Close" variant="secondary" onPress={() => setActionsFor(null)} />
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={reporting !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReporting(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Report this message</Text>
            <Text style={styles.modalBody}>
              This raises a safeguarding concern with the club&apos;s
              safeguarding lead. Your reason is recorded with it.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Why are you reporting this?"
              placeholderTextColor={theme.colour.muted}
              value={reason}
              onChangeText={setReason}
              multiline
              autoFocus
            />
            <Button
              title="Send report"
              onPress={() => {
                void submitReport();
              }}
            />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setReporting(null)}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function MessageBubble({
  message,
  mine,
  senderName,
  quoted,
  quotedName,
  hasUnrenderedQuote,
  chips,
  readByAll,
  attachments,
  onToggleReaction,
  onLongPress,
}: {
  message: MessageRow;
  mine: boolean;
  senderName: string;
  /** The message this one replies to, when it is in the loaded window. */
  quoted: MessageRow | null;
  quotedName: string | null;
  hasUnrenderedQuote: boolean;
  chips: ReactionChip[];
  readByAll: boolean;
  attachments: ThreadAttachment[];
  onToggleReaction: (emoji: string) => void;
  onLongPress: () => void;
}) {
  const withdrawn = isWithdrawn(message);

  return (
    <View style={mine ? styles.bubbleColMine : styles.bubbleColTheirs}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${senderName}: ${messageBody(message)}`}
        accessibilityHint={withdrawn ? undefined : "Hold for reply, reactions and more"}
        disabled={withdrawn}
        onLongPress={onLongPress}
        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
      >
        {mine ? null : <Text style={styles.sender}>{senderName}</Text>}

        {quoted ? (
          // The quote goes through messageBody() too: a deleted or redacted
          // body must never leak back through a reply preview (SG-8).
          <View style={styles.quote}>
            <Text style={styles.quoteName}>{quotedName}</Text>
            <Text style={styles.quoteBody} numberOfLines={2}>
              {messageBody(quoted)}
            </Text>
          </View>
        ) : hasUnrenderedQuote ? (
          <View style={styles.quote}>
            <Text style={styles.quoteBody}>Replying to an earlier message</Text>
          </View>
        ) : null}

        <Text style={[styles.body, withdrawn && styles.bodyWithdrawn]}>
          {messageBody(message)}
        </Text>

        {withdrawn
          ? null
          : attachments.map((attachment) =>
              attachment.url ? (
                <Image
                  key={attachment.id}
                  source={{ uri: attachment.url }}
                  style={styles.image}
                  resizeMode="cover"
                  accessibilityLabel="Attached photo"
                />
              ) : (
                <View key={attachment.id} style={styles.imagePlaceholder}>
                  <Text style={styles.imagePlaceholderText}>
                    📎 Photo attached — cannot be shown on this device
                  </Text>
                </View>
              ),
            )}

        <View style={styles.meta}>
          <Text style={styles.time}>{clockLabelLondon(message.created_at)}</Text>
          {mine && !withdrawn ? (
            <Text
              style={[styles.ticks, readByAll && styles.ticksRead]}
              accessibilityLabel={readByAll ? "Read by everyone" : "Sent"}
            >
              {readByAll ? "✓✓" : "✓"}
            </Text>
          ) : null}
          {withdrawn ? <Pill label="Withdrawn" /> : null}
        </View>
      </Pressable>

      {chips.length > 0 ? (
        <View style={[styles.chipsRow, mine ? styles.chipsRowMine : null]}>
          {chips.map((chip) => (
            <Pressable
              key={chip.emoji}
              accessibilityRole="button"
              accessibilityLabel={
                chip.mine ? `Remove your ${chip.emoji} reaction` : `React ${chip.emoji}`
              }
              onPress={() => onToggleReaction(chip.emoji)}
              style={[styles.chip, chip.mine && styles.chipMine]}
            >
              <Text style={styles.chipText}>
                {chip.emoji}
                {chip.count > 1 ? ` ${chip.count}` : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  bannerWrap: {
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.md,
  },
  messages: { padding: theme.space.md, gap: theme.space.sm },
  bubble: {
    maxWidth: "88%",
    borderRadius: theme.radius.lg,
    padding: theme.space.md - 4,
    gap: theme.space.xs,
  },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: theme.colour.mine },
  bubbleTheirs: {
    alignSelf: "flex-start",
    backgroundColor: theme.colour.surface,
    borderColor: theme.colour.border,
    borderWidth: 1,
  },
  sender: { color: theme.colour.accent, fontSize: 12, fontWeight: "700" },
  bubbleColMine: { alignSelf: "flex-end", maxWidth: "88%", gap: 2 },
  bubbleColTheirs: { alignSelf: "flex-start", maxWidth: "88%", gap: 2 },
  dayChipWrap: { alignItems: "center", paddingVertical: theme.space.sm },
  dayChip: {
    backgroundColor: theme.colour.surface,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.space.md,
    paddingVertical: 3,
    color: theme.colour.muted,
    fontSize: 11,
    fontWeight: "600",
    overflow: "hidden",
  },
  quote: {
    borderLeftColor: theme.colour.accent,
    borderLeftWidth: 3,
    backgroundColor: "rgba(127,127,127,0.12)",
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 4,
    gap: 1,
  },
  quoteName: { color: theme.colour.accent, fontSize: 11, fontWeight: "700" },
  quoteBody: { color: theme.colour.muted, fontSize: 12 },
  ticks: { color: theme.colour.muted, fontSize: 11, fontWeight: "700" },
  ticksRead: { color: "#3aa0ff" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: -2 },
  chipsRowMine: { justifyContent: "flex-end" },
  chip: {
    backgroundColor: theme.colour.surface,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  chipMine: { borderColor: theme.colour.accent },
  chipText: { fontSize: 12, color: theme.colour.text },
  emojiRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: theme.space.xs,
  },
  emojiButton: { padding: theme.space.xs },
  emojiGlyph: { fontSize: 26 },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    borderLeftColor: theme.colour.accent,
    borderLeftWidth: 3,
    backgroundColor: theme.colour.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  replyBarText: { flex: 1, gap: 1 },
  replyBarName: { color: theme.colour.accent, fontSize: 12, fontWeight: "700" },
  replyBarBody: { color: theme.colour.muted, fontSize: 12 },
  body: { color: theme.colour.text, fontSize: 16, lineHeight: 22 },
  bodyWithdrawn: { color: theme.colour.muted, fontStyle: "italic" },
  image: {
    width: 220,
    height: 165,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colour.border,
  },
  imagePlaceholder: {
    width: 220,
    borderRadius: theme.radius.md,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderStyle: "dashed",
    padding: theme.space.md,
  },
  imagePlaceholderText: { color: theme.colour.muted, fontSize: 12 },
  meta: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
  time: { color: theme.colour.muted, fontSize: 11 },
  hint: { color: theme.colour.muted, fontSize: 10, opacity: 0.7 },
  composer: {
    borderTopColor: theme.colour.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: theme.space.md,
    gap: theme.space.sm,
    backgroundColor: theme.colour.background,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.space.sm,
  },
  attach: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    minWidth: 40,
  },
  attachGlyph: { fontSize: 20 },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 48,
    backgroundColor: theme.colour.surface,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    color: theme.colour.text,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    fontSize: 16,
  },
  sendWrap: { minWidth: 84 },
  pending: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    backgroundColor: theme.colour.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  pendingText: { color: theme.colour.text, flex: 1 },
  pendingRemove: { color: theme.colour.danger, fontWeight: "600" },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    padding: theme.space.lg,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalCard: {
    backgroundColor: theme.colour.surface,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.md,
  },
  modalTitle: { color: theme.colour.text, fontSize: 18, fontWeight: "700" },
  modalBody: { color: theme.colour.muted, lineHeight: 20 },
  modalInput: {
    minHeight: 96,
    backgroundColor: theme.colour.background,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    color: theme.colour.text,
    padding: theme.space.md,
    fontSize: 16,
    textAlignVertical: "top",
  },
});
