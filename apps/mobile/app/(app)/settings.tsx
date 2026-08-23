import Constants from "expo-constants";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button, Notice } from "../../components/ui";
import { useAuth } from "../../lib/auth-context";
import { personDisplayName } from "../../lib/club";
import { theme } from "../../lib/theme";
import { useMyClub } from "../../lib/use-my-club";

export default function SettingsScreen() {
  const { session, signOut } = useAuth();
  const { data } = useMyClub(session?.user.id);
  const [busy, setBusy] = useState(false);

  function confirmSignOut() {
    Alert.alert("Sign out", "You will need to sign in again on this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          // The auth listener sends us back to the sign-in group; the stored
          // session is cleared from secure storage by gotrue.
          void signOut().finally(() => setBusy(false));
        },
      },
    ]);
  }

  const version = Constants.expoConfig?.version ?? "0.0.0";

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Profile</Text>
      <View style={styles.rows}>
        <Row label="Name" value={personDisplayName(data?.profile ?? null)} />
        <Row label="Email" value={session?.user.email ?? "—"} />
        <Row label="Account role" value={data?.profile?.role ?? "—"} />
      </View>

      <Notice>
        Contact details are held by the club. Ask a club admin to change your
        name, email or safeguarding consents.
      </Notice>

      <Text style={styles.sectionTitle}>Session</Text>
      <Button
        title="Sign out"
        variant="danger"
        busy={busy}
        onPress={confirmSignOut}
      />

      <Text style={styles.footnote}>AoM Sports Club · v{version}</Text>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  content: { padding: theme.space.lg, gap: theme.space.md },
  sectionTitle: {
    color: theme.colour.text,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: theme.space.sm,
  },
  rows: {
    backgroundColor: theme.colour.surface,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md - 4,
    borderBottomColor: theme.colour.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { color: theme.colour.muted },
  rowValue: { color: theme.colour.text, flexShrink: 1, textAlign: "right" },
  footnote: {
    color: theme.colour.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: theme.space.lg,
  },
});
