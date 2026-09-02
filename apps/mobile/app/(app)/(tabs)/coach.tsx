import { Link } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text } from "react-native";

import { Loading } from "../../../components/loading";
import { Card, Notice, Pill, SectionTitle } from "../../../components/ui";
import { theme } from "../../../lib/theme";
import { useCoachDesk, useStaffTeams } from "../../../lib/use-coach";

/**
 * The coach's desk (Adam, 2026-09-02: "I would want the coach built in").
 *
 * Upcoming games for the teams this person coaches — replies at a glance,
 * the pitch once it is allocated — and the training sessions whose register
 * they keep. The tab itself only exists for team staff (see the tabs
 * layout); everything on it is the database's answer to THIS caller, so a
 * coach of one team sees one team.
 *
 * Deliberately absent: pitch allocation, registrations, anything desk-shaped
 * — those are the club's job on the web, not the touchline's.
 */
export default function CoachScreen() {
  const { teams, loading: teamsLoading } = useStaffTeams();
  const desk = useCoachDesk(teams);

  if (teamsLoading || (desk.loading && desk.fixtures.length === 0 && desk.sessions.length === 0)) {
    return <Loading label="Loading your teams…" />;
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={desk.refreshing}
          onRefresh={desk.refresh}
          tintColor={theme.colour.muted}
        />
      }
    >
      {desk.error ? <Notice tone="error">{desk.error}</Notice> : null}

      {teams.length === 0 && !desk.error ? (
        <Notice>You are not listed as staff of a team this season.</Notice>
      ) : null}

      {desk.fixtures.length > 0 && <SectionTitle>Matches</SectionTitle>}
      {desk.fixtures.map((fixture) => (
        <Link
          key={fixture.id}
          href={{ pathname: "/coach/fixture/[id]", params: { id: fixture.id } }}
          asChild
        >
          <Pressable accessibilityRole="button">
            <Card
              title={`${fixture.teamName} ${fixture.title}`}
              subtitle={fixture.when}
              meta={fixture.where}
              accessory={
                fixture.quiet > 0 ? (
                  <Pill label={`${fixture.quiet} to chase`} tone="warn" />
                ) : (
                  <Pill label="All answered" tone="accent" />
                )
              }
            >
              <Text style={styles.replies}>{fixture.replies}</Text>
            </Card>
          </Pressable>
        </Link>
      ))}

      {desk.fixtures.length === 0 && teams.length > 0 && !desk.error ? (
        <Notice>No games in the next four weeks.</Notice>
      ) : null}

      {desk.sessions.length > 0 && <SectionTitle>Training registers</SectionTitle>}
      {desk.sessions.map((session) => (
        <Link
          key={session.bookingId}
          href={{
            pathname: "/coach/register/[id]",
            params: {
              id: session.bookingId,
              title: session.title,
              when: session.when,
              teams: session.teamIds.join(","),
            },
          }}
          asChild
        >
          <Pressable accessibilityRole="button">
            <Card title={session.title} subtitle={session.when} meta={session.resourceName}>
              <Text style={styles.replies}>Open the register</Text>
            </Card>
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  replies: { color: theme.colour.muted, fontSize: 13 },
});
