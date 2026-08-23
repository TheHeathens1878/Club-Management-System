import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { theme } from "../lib/theme";

export function Field({
  label,
  ...inputProps
}: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={theme.colour.muted}
        {...inputProps}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  busy = false,
  disabled = false,
  variant = "primary",
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && styles.buttonDanger,
        inactive && styles.buttonInactive,
        pressed && styles.buttonPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={theme.colour.background} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant !== "primary" && styles.buttonTextOnDark,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: string;
}) {
  return (
    <View
      style={[
        styles.notice,
        tone === "error" && styles.noticeError,
        tone === "success" && styles.noticeSuccess,
      ]}
    >
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

export function Card({
  title,
  subtitle,
  meta,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      {meta ? <Text style={styles.cardMeta}>{meta}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: theme.space.xs },
  fieldLabel: { color: theme.colour.muted, fontSize: 13 },
  input: {
    backgroundColor: theme.colour.surface,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    color: theme.colour.text,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md - 4,
    fontSize: 16,
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colour.accent,
    borderRadius: theme.radius.md,
    minHeight: 48,
    paddingHorizontal: theme.space.md,
  },
  buttonSecondary: {
    backgroundColor: "transparent",
    borderColor: theme.colour.border,
    borderWidth: 1,
  },
  buttonDanger: {
    backgroundColor: "transparent",
    borderColor: theme.colour.danger,
    borderWidth: 1,
  },
  buttonInactive: { opacity: 0.5 },
  buttonPressed: { opacity: 0.8 },
  buttonText: {
    color: theme.colour.background,
    fontSize: 16,
    fontWeight: "600",
  },
  buttonTextOnDark: { color: theme.colour.text },
  notice: {
    backgroundColor: theme.colour.surface,
    borderRadius: theme.radius.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.colour.border,
    padding: theme.space.md,
  },
  noticeError: { borderLeftColor: theme.colour.danger },
  noticeSuccess: { borderLeftColor: theme.colour.accent },
  noticeText: { color: theme.colour.text, lineHeight: 20 },
  card: {
    backgroundColor: theme.colour.surface,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  cardTitle: { color: theme.colour.text, fontSize: 17, fontWeight: "600" },
  cardSubtitle: { color: theme.colour.muted },
  cardMeta: { color: theme.colour.muted, fontSize: 12 },
});
