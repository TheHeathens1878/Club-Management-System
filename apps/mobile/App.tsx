import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

// Placeholder. Navigation, auth and real screens land in P6.1–P6.3.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>AoM Sports Club</Text>
      <Text style={styles.subtitle}>Monorepo scaffold — P0.1</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  title: { fontSize: 22, fontWeight: "600" },
  subtitle: { fontSize: 14, opacity: 0.6 },
});
