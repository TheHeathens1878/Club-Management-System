import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { theme } from "../lib/theme";

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={theme.colour.accent} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.md,
    backgroundColor: theme.colour.background,
  },
  label: { color: theme.colour.muted },
});
