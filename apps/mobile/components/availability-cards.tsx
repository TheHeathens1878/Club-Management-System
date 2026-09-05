import { StyleSheet, Text, View } from "react-native";

import {
  AVAILABILITY_OPTIONS,
  availabilityLabel,
  describeFixture,
  fixtureTitle,
  PITCH_TBC,
  type Fixture,
} from "../lib/fixtures";
import type { Session } from "../lib/sessions";
import { theme } from "../lib/theme";
import { Card, Pill, Segmented } from "./ui";

type SetAvailability = (
  id: string,
  personId: string,
  status: (typeof AVAILABILITY_OPTIONS)[number],
) => Promise<void>;

/**
 * The two cards a household answers on — a fixture and a training session —
 * shared by the Calendar tab (everything coming up) and Home (only what is
 * still waiting for an answer). One three-way toggle per household member who
 * is registered for that team and season; the write goes to the same table
 * from either screen.
 */
export function FixtureCard({
  fixture,
  saving,
  onSet,
}: {
  fixture: Fixture;
  saving: string | null;
  onSet: SetAvailability;
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
      <Respondents id={fixture.id} respondents={fixture.respondents} saving={saving} onSet={onSet} />
    </Card>
  );
}

export function SessionCard({
  session,
  saving,
  onSet,
}: {
  session: Session;
  saving: string | null;
  onSet: SetAvailability;
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
      <Respondents id={session.id} respondents={session.respondents} saving={saving} onSet={onSet} />
    </Card>
  );
}

function Respondents({
  id,
  respondents,
  saving,
  onSet,
}: {
  id: string;
  respondents: Fixture["respondents"];
  saving: string | null;
  onSet: SetAvailability;
}) {
  if (respondents.length === 0) return null;
  return (
    <View style={styles.availability}>
      {respondents.map((respondent) => {
        const key = `${id}:${respondent.personId}`;
        return (
          <View key={respondent.personId} style={styles.respondent}>
            <View style={styles.respondentHeader}>
              <Text style={styles.respondentName}>{respondent.label}</Text>
              <Text style={styles.respondentStatus}>{availabilityLabel(respondent.status)}</Text>
            </View>
            <Segmented
              options={AVAILABILITY_OPTIONS.map((status) => ({
                value: status,
                label: availabilityLabel(status),
              }))}
              value={respondent.status}
              disabled={saving === key}
              onChange={(status) => {
                void onSet(id, respondent.personId, status);
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

/** True when somebody on the card has not answered yet. */
export function awaitsAnswer(respondents: Fixture["respondents"]): boolean {
  return respondents.some((respondent) => respondent.status === null);
}

const styles = StyleSheet.create({
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
  respondentStatus: { color: theme.colour.muted, fontSize: 12 },
});
