import { useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text } from "react-native";

import { Loading } from "../../../components/loading";
import { Button, Card, Notice, Pill } from "../../../components/ui";
import { paySubscription } from "../../../lib/checkout";
import { poundsFromPence } from "../../../lib/format";
import { useHouseholdContext } from "../../../lib/household-context";
import {
  checkoutBlockedReason,
  describeArrears,
  describeStatus,
  totalOutstandingPence,
} from "../../../lib/subs";
import { theme } from "../../../lib/theme";
import { useSubs } from "../../../lib/use-subs";

/**
 * Subs for the household, from the `subscription_arrears` view.
 *
 * "Pay" is a **web checkout**: it asks the `stripe-checkout` Edge Function for
 * a Stripe Checkout Session and opens it in the system browser. No native
 * Stripe module, no payment sheet, nothing about card entry inside the app —
 * see lib/checkout.ts for why, and for what swapping in a payment sheet later
 * would involve.
 */
export default function SubsScreen() {
  const household = useHouseholdContext();
  const { arrears, loading, refreshing, error, refresh } = useSubs(household.data);
  const [paying, setPaying] = useState<string | null>(null);

  if ((loading || household.loading) && arrears.length === 0) {
    return <Loading label="Loading your subs…" />;
  }

  const outstanding = totalOutstandingPence(arrears);

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
    refresh();
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
          }}
          tintColor={theme.colour.muted}
        />
      }
    >
      {error ? <Notice tone="error">{error}</Notice> : null}

      {arrears.length === 0 && !error ? (
        <Notice>Nothing owing. The club will let you know when subs are due.</Notice>
      ) : null}

      {arrears.length > 0 ? (
        <Text style={styles.total}>
          {outstanding > 0
            ? `${poundsFromPence(outstanding)} outstanding`
            : "All subs paid"}
        </Text>
      ) : null}

      {arrears.map((row) => {
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

      {arrears.length > 0 ? (
        <Text style={styles.footnote}>
          Payment opens Stripe Checkout in your browser. The club is told
          automatically once it clears.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  content: { padding: theme.space.lg, gap: theme.space.md },
  total: { color: theme.colour.text, fontSize: 22, fontWeight: "700" },
  detail: { color: theme.colour.muted },
  footnote: {
    color: theme.colour.muted,
    fontSize: 12,
    marginTop: theme.space.md,
  },
});
