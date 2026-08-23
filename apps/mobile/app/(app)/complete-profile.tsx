import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

import { Button, Field, Notice, SectionTitle } from "../../components/ui";
import { getSupabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";

/**
 * First-login DOB gate for accounts imported from the pitch-booking app
 * (P3.3). The (app) layout redirects here while `needs_dob_completion()` is
 * true; `complete_own_dob()` is the only self-service write to people.dob.
 */
export default function CompleteProfileScreen() {
  const router = useRouter();
  const [dob, setDob] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      setError("Enter your date of birth as YYYY-MM-DD.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await getSupabase().rpc("complete_own_dob", { p_dob: dob });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.replace("/");
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <SectionTitle>One more thing</SectionTitle>
      <Text style={styles.body}>
        Your account has been moved over from the pitch-booking app. The club&apos;s
        safeguarding rules depend on knowing who is an adult, so before you carry on
        we need your date of birth. Until it is recorded the system has to treat you
        as a young person — which is why your teams and conversations are not showing
        yet.
      </Text>
      <Field
        label="Date of birth (YYYY-MM-DD)"
        value={dob}
        onChangeText={setDob}
        placeholder="1985-06-30"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button title="Save and continue" onPress={() => void save()} busy={busy} />
      <Text style={styles.small}>
        Your date of birth is visible only to club administrators and is used solely to
        apply the club&apos;s safeguarding rules.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: theme.space.lg, gap: theme.space.md },
  body: { color: theme.colour.text, lineHeight: 22 },
  small: { color: theme.colour.muted, fontSize: 12, lineHeight: 18 },
});
