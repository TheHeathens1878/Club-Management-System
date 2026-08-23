import { Redirect, Stack } from "expo-router";

import { useAuth } from "../../lib/auth-context";
import { Loading } from "../../components/loading";
import { theme } from "../../lib/theme";

/** Auth gate, inward half: no session means no access to any app screen. */
export default function AppLayout() {
  const { session, initialising } = useAuth();

  if (initialising) return <Loading label="Restoring your session…" />;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colour.background },
        headerTintColor: theme.colour.text,
        contentStyle: { backgroundColor: theme.colour.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "My club" }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
    </Stack>
  );
}
