import { Link, router } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text } from "react-native";

import { awaitsAnswer, FixtureCard, SessionCard } from "../../../components/availability-cards";
import { Loading } from "../../../components/loading";
import { Card, Notice, Pill, SectionTitle } from "../../../components/ui";
import { poundsFromPence } from "../../../lib/format";
import { useHouseholdContext } from "../../../lib/household-context";
import { messagesRoute } from "../../../lib/push";
import { totalOutstandingPence } from "../../../lib/subs";
import { theme } from "../../../lib/theme";
import { useCoachDesk, useStaffTeams } from "../../../lib/use-coach";
import { useConversations } from "../../../lib/use-conversations";
import { useFixtures } from "../../../lib/use-fixtures";
import { useSessions } from "../../../lib/use-sessions";
import { useSubs } from "../../../lib/use-subs";

/**
 * Home (P7.2): what needs the person's attention, then what is next.
 *
 *   · Fixtures and training sessions somebody in the household has not
 *     answered for — with the answer control right here, so the commonest
 *     task in the club is done from the first screen and the card is gone
 *     on the next refresh.
 *   · Subs outstanding, unread messages, and — for a coach — the games with
 *     replies still to chase. Each opens the exact screen.
 *   · Then the next fixture, answered or not, so a quiet week still answers
 *     "what's next".
 *
 * Every number is the database's own answer to THIS caller through the same
 * hooks the tabs use; nothing is added up here that the views do not already
 * add up.
 */
export default function HomeScreen() {
  const household = useHouseholdContext();
  const fixturesState = useFixtures(household.data);
  const sessionsState = useSessions(household.data);
  const subsState = useSubs(household.data);
  const conversations = useConversations(household.data?.personId ?? null);
  const { teams: staffTeams } = useStaffTeams();
  const desk = useCoachDesk(staffTeams);

  const firstLoad =
    (household.loading || fixturesState.loading) && fixturesState.fixtures.length === 0 && !household.data;
  if (firstLoad) return <Loading label="Loading your club…" />;

  const awaitingFixtures = fixturesState.fixtures.filter((fixture) => awaitsAnswer(fixture.respondents));
  const awaitingSessions = sessionsState.sessions.filter((session) => awaitsAnswer(session.respondents));
  const outstanding = totalOutstandingPence(subsState.arrears);
  const unread = conversations.conversations.reduce((sum, c) => sum + c.unreadCount, 0);
  const unreadRoom = conversations.conversations.find((c) => c.unreadCount > 0) ?? null;
  const toChase = desk.fixtures.filter((fixture) => fixture.quiet > 0);
  const next = fixturesState.fixtures[0] ?? null;

  const nothingWaiting =
    awaitingFixtures.length === 0 &&
    awaitingSessions.length === 0 &&
    outstanding <= 0 &&
    unread === 0 &&
    toChase.length === 0;

  const error = household.error ?? fixturesState.error ?? subsState.error ?? conversations.error;

  function refreshAll() {
    household.refresh();
    fixturesState.refresh();
    sessionsState.refresh();
    subsState.refresh();
    conversations.refresh();
    desk.refresh();
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={fixturesState.refreshing || household.refreshing}
          onRefresh={refreshAll}
          tintColor={theme.colour.muted}
        />
      }
    >
      {error ? <Notice tone="error">{error}</Notice> : null}

      {!household.data?.personId && !error ? (
        <Notice>
          Your app account is not linked to a club record yet. A club admin
          needs to finish setting you up.
        </Notice>
      ) : null}

      {nothingWaiting ? (
        <Notice tone="success">Nothing needs you right now.</Notice>
      ) : (
        <SectionTitle>Needs your attention</SectionTitle>
      )}

      {awaitingFixtures.map((fixture) => (
        <FixtureCard
          key={fixture.id}
          fixture={fixture}
          saving={fixturesState.saving}
          onSet={fixturesState.setAvailability}
        />
      ))}
      {awaitingSessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          saving={sessionsState.saving}
          onSet={sessionsState.setAvailability}
        />
      ))}

      {outstanding > 0 ? (
        <Card
          title={`${poundsFromPence(outstanding)} to pay`}
          subtitle="Subs for your household"
          onPress={() => router.push("/me")}
          accessory={<Pill label="Pay" tone="warn" />}
        />
      ) : null}

      {unread > 0 ? (
        <Card
          title={`${unread} unread message${unread === 1 ? "" : "s"}`}
          subtitle={unreadRoom ? unreadRoom.title : "Team rooms and direct messages"}
          onPress={() =>
            router.push(
              (unread === unreadRoom?.unreadCount && unreadRoom
                ? messagesRoute(unreadRoom.id)
                : "/messages") as never,
            )
          }
          accessory={<Pill label={String(unread)} tone="accent" />}
        />
      ) : null}

      {toChase.map((fixture) => (
        <Link
          key={fixture.id}
          href={{ pathname: "/coach/fixture/[id]", params: { id: fixture.id } }}
          asChild
        >
          <Pressable accessibilityRole="button">
            <Card
              title={`${fixture.teamName} ${fixture.title}`}
              subtitle={fixture.when}
              meta={`Coaching · ${fixture.replies}`}
              accessory={<Pill label={`${fixture.quiet} to chase`} tone="warn" />}
            />
          </Pressable>
        </Link>
      ))}

      {next ? (
        <>
          <SectionTitle>Next up</SectionTitle>
          <Card
            title={`${next.teamName} v ${next.opponent}`}
            subtitle={next.kickoff}
            meta={next.venue}
            onPress={() => router.push("/calendar")}
          />
        </>
      ) : null}

      {!next && fixturesState.fixtures.length === 0 && !error && household.data?.personId ? (
        <Text style={styles.footnote}>
          No fixtures in the next few months. They appear here as soon as Full-Time publishes them.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  content: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xl },
  footnote: { color: theme.colour.muted, fontSize: 12, marginTop: theme.space.md },
});
