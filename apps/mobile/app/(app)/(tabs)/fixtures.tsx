import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { Loading } from "../../../components/loading";
import { Card, Notice, Pill, Segmented } from "../../../components/ui";
import {
  AVAILABILITY_OPTIONS,
  availabilityLabel,
  describeFixture,
  fixtureTitle,
  PITCH_TBC,
  type Fixture,
} from "../../../lib/fixtures";
import { useHouseholdContext } from "../../../lib/household-context";
import { type Session } from "../../../lib/sessions";
import { theme } from "../../../lib/theme";
import { useFixtures } from "../../../lib/use-fixtures";
import { useSessions } from "../../../lib/use-sessions";

/**
 * Next fixtures for every team in the household, with the pitch as soon as
 * P2.5 has allocated one, and an availability toggle per household member who
 * is actually registered for that team and season.
 */
export default function FixturesScreen() {
  const household = useHouseholdContext();
  const {
    fixtures,
    loading,
    refreshing,
    error,
    saving,
    refresh,
    setAvailability,
  } = useFixtures(household.data);
  const sessionsState = useSessions(household.data);

  if ((loading || household.loading) && fixtures.length === 0) {
    return <Loading label="Loading fixtures…" />;
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
        <FixtureCard
          key={fixture.id}
          fixture={fixture}
          saving={saving}
          onSet={setAvailability}
        />
      ))}

      {/* Training sessions — the other half of "how many children will be
          there?". Same three-way toggle, written to booking_availability. */}
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

function SessionCard({
  session,
  saving,
  onSet,
}: {
  session: Session;
  saving: string | null;
  onSet: (
    bookingId: string,
    personId: string,
    status: (typeof AVAILABILITY_OPTIONS)[number],
  ) => Promise<void>;
}) {
  return (
    <Card
      title={session.title}
      subtitle={session.when}
      meta={session.resourceName}
      accessory={
        session.status === "pending" ? <Pill label="Awaiting confirmation" tone="neutral" /> : null
      }
    >
      {session.respondents.length === 0 ? null : (
        <View style={styles.availability}>
          {session.respondents.map((respondent) => {
            const key = `${session.id}:${respondent.personId}`;
            return (
              <View key={respondent.personId} style={styles.respondent}>
                <View style={styles.respondentHeader}>
                  <Text style={styles.respondentName}>{respondent.label}</Text>
                  <Text style={styles.respondentStatus}>
                    {availabilityLabel(respondent.status)}
                  </Text>
                </View>
                <Segmented
                  options={AVAILABILITY_OPTIONS.map((status) => ({
                    value: status,
                    label: availabilityLabel(status),
                  }))}
                  value={respondent.status}
                  disabled={saving === key}
                  onChange={(status) => {
                    void onSet(session.id, respondent.personId, status);
                  }}
                />
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

function FixtureCard({
  fixture,
  saving,
  onSet,
}: {
  fixture: Fixture;
  saving: string | null;
  onSet: (
    fixtureId: string,
    personId: string,
    status: (typeof AVAILABILITY_OPTIONS)[number],
  ) => Promise<void>;
}) {
  return (
    <Card
      title={fixtureTitle(fixture)}
      subtitle={fixture.kickoff}
      meta={describeFixture(fixture)}
      accessory={
        <Pill
          label={fixture.venueAllocated ? fixture.venue : PITCH_TBC}
          tone={fixture.venueAllocated ? "accent" : "neutral"}
        />
      }
    >
      {fixture.respondents.length === 0 ? null : (
        <View style={styles.availability}>
          {fixture.respondents.map((respondent) => {
            const key = `${fixture.id}:${respondent.personId}`;
            return (
              <View key={respondent.personId} style={styles.respondent}>
                <View style={styles.respondentHeader}>
                  <Text style={styles.respondentName}>{respondent.label}</Text>
                  <Text style={styles.respondentStatus}>
                    {availabilityLabel(respondent.status)}
                  </Text>
                </View>
                <Segmented
                  options={AVAILABILITY_OPTIONS.map((status) => ({
                    value: status,
                    label: availabilityLabel(status),
                  }))}
                  value={respondent.status}
                  disabled={saving === key}
                  onChange={(status) => {
                    void onSet(fixture.id, respondent.personId, status);
                  }}
                />
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  content: { padding: theme.space.lg, gap: theme.space.md },
  availability: {
    gap: theme.space.sm,
    borderTopColor: theme.colour.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: theme.space.sm,
  },
  respondent: { gap: theme.space.xs },
  respondentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  respondentName: { color: theme.colour.text, fontWeight: "600" },
  sectionTitle: {
    color: theme.colour.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: theme.space.sm,
  },
  respondentStatus: { color: theme.colour.muted, fontSize: 12 },
});
