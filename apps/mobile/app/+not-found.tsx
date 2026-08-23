import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { theme } from "../lib/theme";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View style={styles.container}>
        <Text style={styles.title}>That screen does not exist.</Text>
        <Link href="/" style={styles.link}>
          Back to My club
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.md,
    padding: theme.space.lg,
    backgroundColor: theme.colour.background,
  },
  title: { color: theme.colour.text, fontSize: 18 },
  link: { color: theme.colour.accent, fontSize: 16 },
});
