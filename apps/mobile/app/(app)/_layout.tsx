import { Redirect, Stack } from "expo-router";

import { Loading } from "../../components/loading";
import { useAuth } from "../../lib/auth-context";
import { HouseholdProvider } from "../../lib/household-context";
import { theme } from "../../lib/theme";
import { usePushNavigation } from "../../lib/use-push";

/** Auth gate, inward half: no session means no access to any app screen. */
export default function AppLayout() {
  const { session, initialising } = useAuth();

  // Only once the signed-in stack is mounted can a tapped notification be
  // routed to /messages/<id>; before that there is nothing to navigate.
  usePushNavigation(Boolean(session));

  if (initialising) return <Loading label="Restoring your session…" />;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <HouseholdProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colour.background },
          headerTintColor: theme.colour.text,
          contentStyle: { backgroundColor: theme.colour.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="messages/[id]" options={{ title: "Conversation" }} />
      </Stack>
    </HouseholdProvider>
  );
}
