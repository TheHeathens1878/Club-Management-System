import { Link } from "expo-router";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Card, Notice } from "../../components/ui";
import { Loading } from "../../components/loading";
import { useAuth } from "../../lib/auth-context";
import { describeMembership, personDisplayName } from "../../lib/club";
import { theme } from "../../lib/theme";
import { useMyClub } from "../../lib/use-my-club";

export default function MyClubScreen() {
  const { session } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMyClub(
    session?.user.id,
  );

  if (loading && !data) return <Loading label="Loading your club…" />;

  const name = personDisplayName(data?.profile ?? null);
  const memberships = data?.memberships ?? [];

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
      <View style={styles.header}>
        <Text style={styles.greeting}>Hello, {name}</Text>
        <Text style={styles.email}>{session?.user.email}</Text>
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}

      {!data?.profile && !error ? (
        <Notice>
          Your app account is not linked to a club record yet. A club admin needs
          to finish setting you up.
        </Notice>
      ) : null}

      <Text style={styles.sectionTitle}>My teams</Text>

      {memberships.length === 0 ? (
        <Notice>
          No current team memberships. Fixtures and availability arrive in the
          next release.
        </Notice>
      ) : (
        <View style={styles.list}>
          {memberships.map((membership) => (
            <Card
              key={membership.id}
              title={membership.teamName}
              subtitle={describeMembership(membership)}
              meta={membership.ageGroup ?? undefined}
            />
          ))}
        </View>
      )}

      <Link href="/settings" style={styles.link}>
        Settings
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  content: { padding: theme.space.lg, gap: theme.space.md },
  header: { gap: theme.space.xs },
  greeting: { color: theme.colour.text, fontSize: 24, fontWeight: "700" },
  email: { color: theme.colour.muted },
  sectionTitle: {
    color: theme.colour.text,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: theme.space.sm,
  },
  list: { gap: theme.space.sm },
  link: {
    color: theme.colour.accent,
    fontSize: 16,
    paddingVertical: theme.space.md,
  },
});
