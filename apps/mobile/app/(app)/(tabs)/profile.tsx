import Constants from "expo-constants";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";

import {
  Button,
  Notice,
  Row,
  Rows,
  SectionTitle,
} from "../../../components/ui";
import { useAuth } from "../../../lib/auth-context";
import { openWebPage } from "../../../lib/checkout";
import { isWebAppConfigured, webAppUrl } from "../../../lib/env";
import { useHouseholdContext } from "../../../lib/household-context";
import { theme } from "../../../lib/theme";
import { usePush, type PushStatus } from "../../../lib/use-push";

/**
 * Profile: who the club thinks you are, notifications, and — for a club admin
 * — the two web screens that have no native equivalent yet.
 *
 * The admin section opens the web app in the system browser rather than
 * embedding a WebView. Pitch allocation and Full-Time link management are
 * dense, keyboard-heavy screens that already exist at /pitches and /teams;
 * wrapping them in a WebView would add a native dependency and a second auth
 * session to keep in step, for a worse version of the same page. PLAN P6.2
 * allows either ("both can be web-views initially").
 */
export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const { data, error } = useHouseholdContext();
  const push = usePush(data?.personId ?? null);
  const [busy, setBusy] = useState(false);

  const me = data?.members.find((member) => member.isSelf) ?? null;
  const childCount = (data?.members.length ?? 1) - 1;
  const version = Constants.expoConfig?.version ?? "0.0.0";

  function confirmSignOut() {
    Alert.alert("Sign out", "You will need to sign in again on this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          void signOut().finally(() => setBusy(false));
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <SectionTitle>Profile</SectionTitle>
      <Rows>
        <Row label="Name" value={me?.name ?? "—"} />
        <Row label="Email" value={session?.user.email ?? "—"} />
        <Row
          label="Children in your care"
          value={childCount > 0 ? String(childCount) : "None"}
        />
      </Rows>

      <Notice>
        Contact details are held by the club. Ask a club admin to change your
        name, email or safeguarding consents.
      </Notice>

      <SectionTitle>Notifications</SectionTitle>
      <Rows>
        <Row label="This device" value={pushStatusLabel(push.status)} />
      </Rows>
      {push.error ? <Notice tone="error">{push.error}</Notice> : null}
      {push.status !== "registered" && push.status !== "unsupported" ? (
        <Button
          title="Turn on message notifications"
          variant="secondary"
          onPress={() => {
            void push.enable();
          }}
        />
      ) : null}
      <Text style={styles.footnote}>
        Notifications about a conversation involving a young person deliberately
        do not include the message text.
      </Text>

      {data?.isClubAdmin ? (
        <>
          <SectionTitle>Admin</SectionTitle>
          {isWebAppConfigured ? (
            <>
              <Button
                title="Pitch allocation"
                variant="secondary"
                onPress={() => {
                  void openWebPage(`${webAppUrl}/pitches`);
                }}
              />
              <Button
                title="Teams and Full-Time links"
                variant="secondary"
                onPress={() => {
                  void openWebPage(`${webAppUrl}/teams`);
                }}
              />
              <Text style={styles.footnote}>
                These open the club web app in your browser. You will be asked
                to sign in there separately.
              </Text>
            </>
          ) : (
            <Notice>
              Set EXPO_PUBLIC_WEB_URL in this build to reach pitch allocation
              and Full-Time link management.
            </Notice>
          )}
        </>
      ) : null}

      <SectionTitle>Session</SectionTitle>
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

function pushStatusLabel(status: PushStatus): string {
  switch (status) {
    case "registered":
      return "On";
    case "granted":
      return "Registering…";
    case "denied":
      return "Off — turn on in Settings";
    case "unsupported":
      return "Not available on a simulator";
    case "error":
      return "Could not set up";
    default:
      return "Checking…";
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  content: { padding: theme.space.lg, gap: theme.space.md },
  footnote: {
    color: theme.colour.muted,
    fontSize: 12,
  },
});
