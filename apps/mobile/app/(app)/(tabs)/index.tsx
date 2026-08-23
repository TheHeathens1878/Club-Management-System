import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { Loading } from "../../../components/loading";
import { Card, Notice, SectionTitle } from "../../../components/ui";
import { useHouseholdContext } from "../../../lib/household-context";
import { describeMembership } from "../../../lib/teams";
import { theme } from "../../../lib/theme";

/**
 * "My teams" — the signed-in person's live memberships, and those of every
 * child they currently guard. A parent with three children opens this to see
 * three sections, not to switch profiles.
 *
 * Names come through `display_name()` and memberships through RLS, so a child
 * whose guardianship has ended simply is not here.
 */
export default function MyTeamsScreen() {
  const { data, loading, refreshing, error, refresh } = useHouseholdContext();

  if (loading && !data) return <Loading label="Loading your club…" />;

  const sections = data?.teamsByPerson ?? [];
  const hasAnyTeam = sections.some((section) => section.teams.length > 0);

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

      {!data?.personId && !error ? (
        <Notice>
          Your app account is not linked to a club record yet. A club admin
          needs to finish setting you up.
        </Notice>
      ) : null}

      {sections.map((section) => (
        <View key={section.personId} style={styles.section}>
          <SectionTitle>{section.name}</SectionTitle>
          {section.teams.length === 0 ? (
            <Notice>
              {section.isSelf
                ? "You are not in a team this season."
                : `${section.name} is not in a team this season.`}
            </Notice>
          ) : (
            <View style={styles.list}>
              {section.teams.map((membership) => (
                <Card
                  key={membership.id}
                  title={membership.teamName}
                  subtitle={describeMembership(membership)}
                  meta={membership.ageGroup ?? undefined}
                />
              ))}
            </View>
          )}
        </View>
      ))}

      {hasAnyTeam ? (
        <Text style={styles.footnote}>
          Fixtures and availability for these teams are on the Fixtures tab.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  content: { padding: theme.space.lg, gap: theme.space.md },
  section: { gap: theme.space.sm },
  list: { gap: theme.space.sm },
  footnote: {
    color: theme.colour.muted,
    fontSize: 12,
    marginTop: theme.space.md,
  },
});
