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
import { authRedirectUrl, useAuth } from "../../lib/auth-context";
import {
  authErrorMessage,
  isProbablyEmail,
  normaliseOtpToken,
} from "../../lib/club";
import { getSupabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";

/**
 * Passwordless sign-in. Supabase sends one email containing both a link (which
 * deep-links back into the app and is handled by AuthProvider) and a six-digit
 * code, so a member whose mail client mangles the link can still get in.
 *
 * `shouldCreateUser: false` — accounts are provisioned by the club, never by
 * someone typing an address here.
 */
export default function MagicLinkScreen() {
  const { linkError, clearLinkError } = useAuth();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink() {
    setError(null);
    clearLinkError();
    setBusy(true);
    try {
      const { error: otpError } = await getSupabase().auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: authRedirectUrl(),
        },
      });
      if (otpError) setError(authErrorMessage(otpError));
      else setSent(true);
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError(null);
    setBusy(true);
    try {
      const { error: verifyError } = await getSupabase().auth.verifyOtp({
        email: email.trim(),
        token,
        type: "email",
      });
      if (verifyError) setError(authErrorMessage(verifyError));
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
          <Text style={styles.title}>Magic link</Text>
          <Text style={styles.subtitle}>
            We will email you a link that opens straight back into the app.
          </Text>
        </View>

        {linkError ? <Notice tone="error">{linkError}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {sent && !error ? (
          <Notice tone="success">
            Check your email. Tap the link, or type the six-digit code below.
          </Notice>
        ) : null}

        <Field
          label="Email"
          value={email}
          onChangeText={(next) => {
            setEmail(next);
            setSent(false);
          }}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          inputMode="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          textContentType="username"
        />

        <Button
          title={sent ? "Send another link" : "Email me a link"}
          busy={busy && !sent}
          disabled={!isProbablyEmail(email) || busy}
          onPress={() => void sendLink()}
        />

        {sent ? (
          <View style={styles.codeBlock}>
            <Field
              label="Six-digit code"
              value={token}
              onChangeText={(next) => setToken(normaliseOtpToken(next))}
              inputMode="numeric"
              keyboardType="number-pad"
              maxLength={6}
              placeholder="123456"
              textContentType="oneTimeCode"
            />
            <Button
              title="Verify code"
              variant="secondary"
              busy={busy}
              disabled={token.length !== 6 || busy}
              onPress={() => void verifyCode()}
            />
          </View>
        ) : null}
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
  codeBlock: { gap: theme.space.md, marginTop: theme.space.sm },
});
