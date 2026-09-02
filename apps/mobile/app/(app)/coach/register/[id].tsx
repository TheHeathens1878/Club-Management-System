import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Loading } from "../../../../components/loading";
import { Card, Notice, Segmented } from "../../../../components/ui";
import { ATTENDANCE_LABELS, ATTENDANCE_OPTIONS } from "../../../../lib/coach";
import { theme } from "../../../../lib/theme";
import { useRegister } from "../../../../lib/use-coach";

/**
 * The training register (Adam, 2026-09-02: the attendance sheet "should only
 * be available to coaches" — and now the coach is in the app, so here it is,
 * on the touchline instead of a laptop).
 *
 * Every player of the session's teams, present / late / absent, saved as it
 * is tapped. The writes are exactly what `booking_attendance_staff_write`
 * allows: this booking's staff or a club administrator, marking this
 * booking's own members — the screen holds no authority of its own.
 */
export default function RegisterScreen() {
  const params = useLocalSearchParams<{
    id: string;
    title?: string;
    when?: string;
    teams?: string;
  }>();
  const teamIds = (params.teams ?? "").split(",").filter(Boolean);
  const register = useRegister(params.id ?? null, teamIds);

  if (register.loading) return <Loading label="Loading the register…" />;

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {params.title ? (
        <Card title={params.title} subtitle={params.when ?? undefined} />
      ) : null}

      {register.error ? <Notice tone="error">{register.error}</Notice> : null}

      {teamIds.length === 0 ? (
        <Notice>Open this register from the Coach tab.</Notice>
      ) : register.rows.length === 0 && !register.error ? (
        <Notice>No players are registered on this session&apos;s teams yet.</Notice>
      ) : null}

      {register.rows.map((row) => (
        <View key={row.personId} style={styles.row}>
          <Text style={styles.name}>{row.name}</Text>
          <Segmented
            options={ATTENDANCE_OPTIONS.map((value) => ({
              value,
              label: ATTENDANCE_LABELS[value],
            }))}
            value={row.status}
            onChange={(status) => void register.mark(row.personId, status)}
            disabled={register.saving === row.personId}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  row: { gap: 6 },
  name: { color: theme.colour.text, fontSize: 15, fontWeight: "600" },
});
