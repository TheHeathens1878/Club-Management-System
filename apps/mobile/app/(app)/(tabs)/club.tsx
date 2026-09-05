import { Link } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { Loading } from "../../../components/loading";
import { Card, Notice, Pill, SectionTitle } from "../../../components/ui";
import { useHouseholdContext } from "../../../lib/household-context";
import { describeMembership } from "../../../lib/teams";
import { theme } from "../../../lib/theme";
import { useCoachDesk, useStaffTeams } from "../../../lib/use-coach";

/**
 * Club (P7.2): the household's teams — one section per person, so a parent
 * with three children sees three sections, not three profiles — and then,
 * for team staff, the coaching desk under a heading that says whose it is:
 * "Coaching · U14 Mavericks". Both halves on one screen; no tab to switch.
 *
 * Names come through `display_name()` and memberships through RLS, so a
 * child whose guardianship has ended simply is not here; the desk is the
 * database's answer to THIS caller, so a coach of one team sees one team.
 */
export default function ClubScreen() {
  const { data, loading, refreshing, error, refresh } = useHouseholdContext();
  const { teams: staffTeams, loading: teamsLoading } = useStaffTeams();
  const desk = useCoachDesk(staffTeams);

  if (loading && !data) return <Loading label="Loading your club…" />;

  const sections = data?.teamsByPerson ?? [];
  const coachingLabel =
    staffTeams.length === 1
      ? `Coaching · ${staffTeams[0]!.name}`
      : staffTeams.length > 1
        ? `Coaching · ${staffTeams.map((team) => team.name).join(", ")}`
        : "Coaching";

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing || desk.refreshing}
          onRefresh={() => {
            refresh();
            desk.refresh();
          }}
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
          <SectionTitle>{section.isSelf ? "Your teams" : `${section.name}'s teams`}</SectionTitle>
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

      {sections.some((section) => section.teams.length > 0) ? (
        <Text style={styles.footnote}>Fixtures and availability are on the Calendar tab.</Text>
      ) : null}

      {!teamsLoading && staffTeams.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle>{coachingLabel}</SectionTitle>
          {desk.error ? <Notice tone="error">{desk.error}</Notice> : null}

          {desk.fixtures.length > 0 && <Text style={styles.subheading}>Matches</Text>}
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
          {desk.fixtures.length === 0 && !desk.loading && !desk.error ? (
            <Notice>No games in the next four weeks.</Notice>
          ) : null}

          {desk.sessions.length > 0 && <Text style={styles.subheading}>Training registers</Text>}
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
                  <Text style={styles.replies}>Open the register — record attendance</Text>
                </Card>
              </Pressable>
            </Link>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  content: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xl },
  section: { gap: theme.space.sm },
  list: { gap: theme.space.sm },
  subheading: { color: theme.colour.muted, fontSize: 13, fontWeight: "600" },
  replies: { color: theme.colour.muted, fontSize: 13 },
  footnote: { color: theme.colour.muted, fontSize: 12 },
});
