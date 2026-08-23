import { Redirect, Stack } from "expo-router";

import { useAuth } from "../../lib/auth-context";
import { Loading } from "../../components/loading";
import { theme } from "../../lib/theme";

/** Auth gate, outward half: a signed-in user never sees the sign-in screens. */
export default function AuthLayout() {
  const { session, initialising } = useAuth();

  if (initialising) return <Loading label="Checking your session…" />;
  if (session) return <Redirect href="/" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colour.background },
        headerTintColor: theme.colour.text,
        contentStyle: { backgroundColor: theme.colour.background },
      }}
    >
      <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
      <Stack.Screen name="magic-link" options={{ title: "Magic link" }} />
    </Stack>
  );
}
