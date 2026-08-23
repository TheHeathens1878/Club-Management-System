import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet, Text, View } from "react-native";

import { AuthProvider } from "../lib/auth-context";
import { isSupabaseConfigured, missingSupabaseEnvVars } from "../lib/env";
import { theme } from "../lib/theme";

export default function RootLayout() {
  if (!isSupabaseConfigured) {
    return <MissingConfiguration />;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.colour.background },
            headerTintColor: theme.colour.text,
            contentStyle: { backgroundColor: theme.colour.background },
          }}
        >
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Shown instead of the app when the build has no Supabase configuration —
 * clearer than the client throwing during module evaluation.
 */
function MissingConfiguration() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Configuration missing</Text>
      <Text style={styles.body}>
        Copy apps/mobile/.env.example to .env.local and set:
      </Text>
      {missingSupabaseEnvVars.map((name) => (
        <Text key={name} style={styles.code}>
          {name}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.space.lg,
    gap: theme.space.sm,
    backgroundColor: theme.colour.background,
  },
  title: { color: theme.colour.text, fontSize: 20, fontWeight: "600" },
  body: { color: theme.colour.muted, textAlign: "center" },
  code: { color: theme.colour.accent, fontFamily: "monospace" },
});
