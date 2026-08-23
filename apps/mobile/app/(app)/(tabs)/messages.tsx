import { router } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { Loading } from "../../../components/loading";
import { Card, Notice, Pill } from "../../../components/ui";
import { useHouseholdContext } from "../../../lib/household-context";
import { SUPERVISED_BADGE } from "../../../lib/messaging";
import { messagesRoute } from "../../../lib/push";
import { theme } from "../../../lib/theme";
import { useConversations } from "../../../lib/use-conversations";

/**
 * The conversation list.
 *
 * A supervised conversation is flagged here as well as in the thread, so
 * nobody opens one and is surprised by the SG-9 banner.
 */
export default function MessagesScreen() {
  const household = useHouseholdContext();
  const personId = household.data?.personId ?? null;
  const { conversations, loading, refreshing, error, refresh } =
    useConversations(personId);

  if ((loading || household.loading) && conversations.length === 0) {
    return <Loading label="Loading your messages…" />;
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={theme.colour.muted}
        />
      }
    >
      {error ? <Notice tone="error">{error}</Notice> : null}

      {conversations.length === 0 && !error ? (
        <Notice>
          No conversations yet. Team rooms appear here once you are added to a
          team.
        </Notice>
      ) : null}

      {conversations.map((conversation) => (
        <Card
          key={conversation.id}
          title={conversation.title}
          subtitle={conversation.preview || "No messages yet"}
          onPress={() => router.push(messagesRoute(conversation.id) as never)}
          accessory={
            <View style={styles.accessory}>
              <Text style={styles.when}>{conversation.lastMessageAgo}</Text>
              {conversation.unreadCount > 0 ? (
                <Pill label={String(conversation.unreadCount)} tone="accent" />
              ) : null}
            </View>
          }
        >
          <View style={styles.flags}>
            {conversation.supervised ? (
              <Pill label={SUPERVISED_BADGE} tone="warn" />
            ) : null}
            {conversation.muted ? <Pill label="Muted" /> : null}
            {conversation.closed ? <Pill label="Closed" /> : null}
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  content: { padding: theme.space.lg, gap: theme.space.md },
  accessory: { alignItems: "flex-end", gap: theme.space.xs },
  when: { color: theme.colour.muted, fontSize: 12 },
  flags: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
});
