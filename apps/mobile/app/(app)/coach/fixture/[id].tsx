import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Loading } from "../../../../components/loading";
import { Button, Card, Notice, Pill, SectionTitle } from "../../../../components/ui";
import { fixtureTitle, type SquadEntry } from "../../../../lib/coach";
import { clubDateTime } from "../../../../lib/format";
import { getSupabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { kickoffFields, useKickoff, useSquadSheet } from "../../../../lib/use-coach";

/**
 * One game, from the coach's side: who is in, who is out, who has not
 * answered — and the kick-off, editable right here (Adam, 2026-09-02:
 * "Coaches to have the ability on the event", and now "the coach built in").
 *
 * The screen loads everything from the fixture id, so a tap from the desk
 * and a cold open behave the same. The squad sheet is `event_people()`'s
 * answer to THIS caller — refused to outsiders, and the refusal renders as a
 * sentence, not an error screen.
 */

type FixtureRow = {
  id: string;
  team_id: string;
  opponent: string;
  is_home: boolean;
  kickoff_at: string;
  status: string;
  venue_text: string | null;
};

export default function CoachFixtureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [fixture, setFixture] = useState<FixtureRow | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const supabase = getSupabase();
    void (async () => {
      try {
        const [fixtureResult, eventResult] = await Promise.all([
          supabase
            .from("fixtures")
            .select("id,team_id,opponent,is_home,kickoff_at,status,venue_text")
            .eq("id", id)
            .maybeSingle(),
          supabase.from("events").select("id").eq("fixture_id", id).maybeSingle(),
        ]);
        if (!active) return;
        if (fixtureResult.error) throw fixtureResult.error;
        setFixture((fixtureResult.data as FixtureRow | null) ?? null);
        setEventId(eventResult.data?.id ?? null);
        setLoadError(null);
      } catch (caught) {
        if (!active) return;
        setLoadError(caught instanceof Error ? caught.message : "Could not load this match.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, nonce]);

  const squad = useSquadSheet(eventId);

  if (loading) return <Loading label="Loading the match…" />;

  if (!fixture) {
    return (
      <View style={styles.content}>
        <Notice tone="error">{loadError ?? "That match no longer exists."}</Notice>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            refresh();
            squad.refresh();
          }}
          tintColor={theme.colour.muted}
        />
      }
    >
      <Card
        title={fixtureTitle(fixture)}
        subtitle={clubDateTime(fixture.kickoff_at)}
        meta={fixture.venue_text || (fixture.is_home ? "Home" : "Away — ground TBC")}
        accessory={
          fixture.status !== "scheduled" ? (
            <Pill label={fixture.status} tone="warn" />
          ) : null
        }
      />

      {fixture.status === "scheduled" ? (
        <KickoffEditor fixture={fixture} onSaved={refresh} />
      ) : null}

      <SectionTitle>Who's coming</SectionTitle>
      {squad.loading ? <Loading label="Loading the squad…" /> : null}
      {squad.hidden ? (
        <Notice>The squad sheet for this game is not yours to see.</Notice>
      ) : null}
      {squad.sheet ? (
        <>
          <SquadGroup heading="In" entries={squad.sheet.yes} />
          <SquadGroup heading="Out" entries={squad.sheet.no} />
          <SquadGroup heading="No answer yet" entries={squad.sheet.quiet} />
          {squad.sheet.organisers.length > 0 ? (
            <Text style={styles.organisers}>
              Organisers: {squad.sheet.organisers.join(", ")}
            </Text>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function SquadGroup({ heading, entries }: { heading: string; entries: SquadEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <Card title={`${heading} (${entries.length})`}>
      <View style={styles.group}>
        {entries.map((entry) => (
          <View key={entry.personId} style={styles.member}>
            <Text style={styles.memberName}>
              {entry.name}
              {entry.stale ? "  ·  answered before the change" : ""}
            </Text>
            {entry.note ? <Text style={styles.memberNote}>{entry.note}</Text> : null}
          </View>
        ))}
      </View>
    </Card>
  );
}

/**
 * The kick-off, as two fields the touchline can type: the London date and
 * time, prefilled from the fixture. The save is the caller's own UPDATE —
 * `fixtures_staff_update` decides — and the database moves the booking, the
 * diary entry and the notifications itself (see lib/use-coach.ts).
 */
function KickoffEditor({ fixture, onSaved }: { fixture: FixtureRow; onSaved: () => void }) {
  const prefill = kickoffFields(fixture.kickoff_at);
  const [date, setDate] = useState(prefill.date);
  const [time, setTime] = useState(prefill.time);
  const kickoff = useKickoff(onSaved);

  return (
    <Card title="Kick-off">
      <View style={styles.editor}>
        <View style={styles.fields}>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.colour.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Kick-off date"
          />
          <TextInput
            value={time}
            onChangeText={setTime}
            placeholder="10:30"
            placeholderTextColor={theme.colour.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            style={[styles.input, styles.timeInput]}
            accessibilityLabel="Kick-off time"
          />
        </View>
        <Button
          title="Move kick-off"
          busy={kickoff.saving}
          onPress={() => void kickoff.save(fixture.id, date.trim(), time.trim())}
          disabled={date.trim() === prefill.date && time.trim() === prefill.time}
        />
        {kickoff.error ? <Notice tone="error">{kickoff.error}</Notice> : null}
        {kickoff.notice ? <Notice>{kickoff.notice}</Notice> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  group: { gap: 8 },
  member: { gap: 2 },
  memberName: { color: theme.colour.text, fontSize: 15 },
  memberNote: { color: theme.colour.muted, fontSize: 13 },
  organisers: { color: theme.colour.muted, fontSize: 13 },
  editor: { gap: 10 },
  fields: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: theme.colour.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: theme.colour.text,
    backgroundColor: theme.colour.surface,
    fontVariant: ["tabular-nums"],
  },
  timeInput: { flex: 0, minWidth: 92 },
});
