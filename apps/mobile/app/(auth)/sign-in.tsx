import { Link } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button, Field, Notice } from "../../components/ui";
import { useAuth } from "../../lib/auth-context";
import { authErrorMessage, isProbablyEmail } from "../../lib/club";
import { getSupabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";

export default function SignInScreen() {
  const { linkError, clearLinkError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = isProbablyEmail(email) && password.length > 0 && !busy;

  async function signIn() {
    setError(null);
    clearLinkError();
    setBusy(true);
    try {
      const { error: signInError } = await getSupabase().auth.signInWithPassword(
        { email: email.trim(), password },
      );
      // On success the auth listener in AuthProvider swaps the route group;
      // there is nothing to navigate to by hand.
      if (signInError) setError(authErrorMessage(signInError));
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>AoM Sports Club</Text>
          <Text style={styles.subtitle}>
            Sign in with the email address the club holds for you.
          </Text>
        </View>

        {linkError ? <Notice tone="error">{linkError}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          inputMode="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          textContentType="username"
        />

        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          secureTextEntry
          placeholder="••••••••"
          textContentType="password"
          onSubmitEditing={() => {
            if (canSubmit) void signIn();
          }}
          returnKeyType="go"
        />

        <Button
          title="Sign in"
          busy={busy}
          disabled={!canSubmit}
          onPress={() => void signIn()}
        />

        <View style={styles.divider}>
          <Text style={styles.dividerText}>or</Text>
        </View>

        <Link href="/magic-link" asChild>
          <Text style={styles.link}>Email me a magic link instead</Text>
        </Link>

        <Text style={styles.footnote}>
          Accounts are created by the club. If you cannot sign in, ask a club
          admin to send you an invite.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.background },
  content: {
    padding: theme.space.lg,
    gap: theme.space.md,
    justifyContent: "center",
    flexGrow: 1,
  },
  header: { gap: theme.space.xs, marginBottom: theme.space.sm },
  title: { color: theme.colour.text, fontSize: 26, fontWeight: "700" },
  subtitle: { color: theme.colour.muted, lineHeight: 20 },
  divider: { alignItems: "center", paddingVertical: theme.space.xs },
  dividerText: { color: theme.colour.muted },
  link: {
    color: theme.colour.accent,
    textAlign: "center",
    fontSize: 16,
    paddingVertical: theme.space.sm,
  },
  footnote: {
    color: theme.colour.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: theme.space.md,
  },
});
