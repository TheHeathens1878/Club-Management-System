import { Redirect, Stack, useSegments } from "expo-router";
import { useEffect, useState } from "react";

import { Loading } from "../../components/loading";
import { useAuth } from "../../lib/auth-context";
import { HouseholdProvider } from "../../lib/household-context";
import { getSupabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { usePushNavigation } from "../../lib/use-push";

/** Auth gate, inward half: no session means no access to any app screen. */
export default function AppLayout() {
  const { session, initialising } = useAuth();
  const segments = useSegments();
  // P3.3 first-login gate: an account imported from the pitch-booking app
  // must record its date of birth before anything else (SG-0 treats an
  // unknown DOB as a minor). null = not yet asked.
  const [needsDob, setNeedsDob] = useState<boolean | null>(null);

  // Only once the signed-in stack is mounted can a tapped notification be
  // routed to /messages/<id>; before that there is nothing to navigate.
  usePushNavigation(Boolean(session));

  useEffect(() => {
    if (!session) {
      setNeedsDob(null);
      return;
    }
    let cancelled = false;
    getSupabase()
      .rpc("needs_dob_completion")
      .then(({ data }) => {
        if (!cancelled) setNeedsDob(data === true);
      });
    return () => {
      cancelled = true;
    };
  }, [session, segments.join("/")]);

  if (initialising) return <Loading label="Restoring your session…" />;
  if (!session) return <Redirect href="/sign-in" />;
  if (needsDob === null) return <Loading label="Checking your profile…" />;
  const onGate = segments.includes("complete-profile" as never);
  if (needsDob && !onGate) return <Redirect href="/complete-profile" />;

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
        <Stack.Screen name="complete-profile" options={{ title: "One more thing", headerBackVisible: false }} />
      </Stack>
    </HouseholdProvider>
  );
}
