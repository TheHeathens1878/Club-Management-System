import { RefreshControl, ScrollView, StyleSheet, Text } from "react-native";

import { FixtureCard, SessionCard } from "../../../components/availability-cards";
import { Loading } from "../../../components/loading";
import { Notice } from "../../../components/ui";
import { useHouseholdContext } from "../../../lib/household-context";
import { theme } from "../../../lib/theme";
import { useFixtures } from "../../../lib/use-fixtures";
import { useSessions } from "../../../lib/use-sessions";

/**
 * Calendar: next fixtures for every team in the household, with the pitch as
 * soon as P2.5 has allocated one, and an availability toggle per household
 * member who is actually registered for that team and season. Training
 * sessions follow, with the same three-way answer.
 */
export default function CalendarScreen() {
  const household = useHouseholdContext();
  const { fixtures, loading, refreshing, error, saving, refresh, setAvailability } =
    useFixtures(household.data);
  const sessionsState = useSessions(household.data);

  if ((loading || household.loading) && fixtures.length === 0) {
    return <Loading label="Loading your calendar…" />;
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            household.refresh();
            refresh();
            sessionsState.refresh();
          }}
          tintColor={theme.colour.muted}
        />
      }
    >
      {error ? <Notice tone="error">{error}</Notice> : null}

      {fixtures.length === 0 && !error ? (
        <Notice>
          No fixtures in the next few months. They appear here as soon as
          Full-Time publishes them.
        </Notice>
      ) : null}

      {fixtures.map((fixture) => (
        <FixtureCard key={fixture.id} fixture={fixture} saving={saving} onSet={setAvailability} />
      ))}

      {(sessionsState.sessions.length > 0 || sessionsState.error) && (
        <Text style={styles.sectionTitle}>Training</Text>
      )}
      {sessionsState.error ? <Notice tone="error">{sessionsState.error}</Notice> : null}
      {sessionsState.sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          saving={sessionsState.saving}
          onSet={sessionsState.setAvailability}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  content: { padding: theme.space.lg, gap: theme.space.md },
  sectionTitle: {
    color: theme.colour.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: theme.space.sm,
  },
});
