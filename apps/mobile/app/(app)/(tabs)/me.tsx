import Constants from "expo-constants";
import { useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text } from "react-native";

import { Button, Card, Notice, Pill, Row, Rows, SectionTitle } from "../../../components/ui";
import { useAuth } from "../../../lib/auth-context";
import { openWebPage, paySubscription } from "../../../lib/checkout";
import { isWebAppConfigured, webAppUrl } from "../../../lib/env";
import { poundsFromPence } from "../../../lib/format";
import { useHouseholdContext } from "../../../lib/household-context";
import {
  checkoutBlockedReason,
  describeArrears,
  describeStatus,
  totalOutstandingPence,
} from "../../../lib/subs";
import { theme } from "../../../lib/theme";
import { usePush, type PushStatus } from "../../../lib/use-push";
import { useSubs } from "../../../lib/use-subs";

/**
 * Me (P7.2): the person — who the club thinks you are, your household's
 * subs with "Pay", notifications, the admin's two web screens, and the way
 * out. The Subs tab folded in here: money is a thing about you, not a
 * destination of its own, and Home already surfaces what is owed.
 *
 * "Pay" is a **web checkout**: it asks the `stripe-checkout` Edge Function
 * for a Checkout Session and opens it in the system browser. Nothing about
 * card entry inside the app — see lib/checkout.ts.
 */
export default function MeScreen() {
  const { session, signOut } = useAuth();
  const household = useHouseholdContext();
  const { data, error } = household;
  const subs = useSubs(data);
  const push = usePush(data?.personId ?? null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);

  const me = data?.members.find((member) => member.isSelf) ?? null;
  const childCount = (data?.members.length ?? 1) - 1;
  const version = Constants.expoConfig?.version ?? "0.0.0";
  const outstanding = totalOutstandingPence(subs.arrears);

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

  async function pay(subscriptionId: string) {
    setPaying(subscriptionId);
    const result = await paySubscription(subscriptionId);
    setPaying(null);
    if (!result.ok) {
      Alert.alert("Could not start checkout", result.error);
      return;
    }
    // Stripe confirms by webhook, not by the browser closing, so the row is
    // re-read rather than assumed paid.
    subs.refresh();
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={subs.refreshing || household.refreshing}
          onRefresh={() => {
            household.refresh();
            subs.refresh();
          }}
          tintColor={theme.colour.muted}
        />
      }
    >
      {error ? <Notice tone="error">{error}</Notice> : null}

      <SectionTitle>Profile</SectionTitle>
      <Rows>
        <Row label="Name" value={me?.name ?? "—"} />
        <Row label="Email" value={session?.user.email ?? "—"} />
        <Row label="Children in your care" value={childCount > 0 ? String(childCount) : "None"} />
      </Rows>
      <Notice>
        Contact details are held by the club. Ask a club admin to change your
        name, email or safeguarding consents.
      </Notice>

      <SectionTitle>Subs and payments</SectionTitle>
      {subs.error ? <Notice tone="error">{subs.error}</Notice> : null}
      {subs.arrears.length === 0 && !subs.error && !subs.loading ? (
        <Notice>Nothing owing. The club will let you know when subs are due.</Notice>
      ) : null}
      {subs.arrears.length > 0 ? (
        <Text style={styles.total}>
          {outstanding > 0 ? `${poundsFromPence(outstanding)} outstanding` : "All subs paid"}
        </Text>
      ) : null}
      {subs.arrears.map((row) => {
        const blocked = checkoutBlockedReason(row);
        return (
          <Card
            key={row.subscriptionId}
            title={row.planName}
            subtitle={`${row.personName}${row.teamName ? ` · ${row.teamName}` : ""}`}
            meta={describeStatus(row)}
            accessory={
              <Pill
                label={poundsFromPence(row.outstandingPence)}
                tone={row.outstandingPence > 0 ? "warn" : "accent"}
              />
            }
          >
            <Text style={styles.detail}>{describeArrears(row)}</Text>
            {row.canCheckout ? (
              <Button
                title={`Pay ${poundsFromPence(row.outstandingPence)}`}
                busy={paying === row.subscriptionId}
                onPress={() => {
                  void pay(row.subscriptionId);
                }}
              />
            ) : null}
            {blocked ? <Notice>{blocked}</Notice> : null}
          </Card>
        );
      })}
      {subs.arrears.length > 0 ? (
        <Text style={styles.footnote}>
          Payment opens a secure checkout in your browser. The club is told
          automatically once it clears.
        </Text>
      ) : null}

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
          <SectionTitle>Club administration</SectionTitle>
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
      <Button title="Sign out" variant="danger" busy={busy} onPress={confirmSignOut} />

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
  content: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xl },
  total: { color: theme.colour.text, fontSize: 22, fontWeight: "700" },
  detail: { color: theme.colour.muted },
  footnote: { color: theme.colour.muted, fontSize: 12 },
});
