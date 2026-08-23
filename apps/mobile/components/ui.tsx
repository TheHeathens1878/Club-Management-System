import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
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

/**
 * The SG-9 safeguarding banner and anything else that must stay on screen.
 *
 * Deliberately not dismissible and not collapsible: SAFEGUARDING.md SG-9 says
 * a monitored conversation shows a *persistent* banner to every participant,
 * and "a conversation that is monitored without the banner is a defect".
 */
export function Banner({
  title,
  children,
}: {
  title: string;
  children: string;
}) {
  return (
    <View
      accessibilityRole="alert"
      accessible
      accessibilityLabel={`${title}. ${children}`}
      style={styles.banner}
    >
      <Text style={styles.bannerTitle}>{title}</Text>
      <Text style={styles.bannerBody}>{children}</Text>
    </View>
  );
}

export function Card({
  title,
  subtitle,
  meta,
  children,
  onPress,
  accessory,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  children?: React.ReactNode;
  onPress?: () => void;
  accessory?: React.ReactNode;
}) {
  const body = (
    <>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>{title}</Text>
          {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
          {meta ? <Text style={styles.cardMeta}>{meta}</Text> : null}
        </View>
        {accessory}
      </View>
      {children}
    </>
  );

  if (!onPress) return <View style={styles.card}>{body}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {body}
    </Pressable>
  );
}

/** Uppercase section heading used down the length of every tab. */
export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/** A small pill: unread counts, "Home"/"Away", conversation flags. */
export function Pill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "accent" | "warn";
}) {
  return (
    <View
      style={[
        styles.pill,
        tone === "accent" && styles.pillAccent,
        tone === "warn" && styles.pillWarn,
      ]}
    >
      <Text
        style={[styles.pillText, tone === "accent" && styles.pillTextOnAccent]}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * Three-way availability control. Segmented rather than a switch, because
 * "maybe" is a real answer a coach needs and a two-state toggle cannot carry.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  style,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentSelected,
              disabled && styles.segmentDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                selected && styles.segmentTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Label/value row used on the profile tab. */
export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function Rows({ children }: { children: React.ReactNode }) {
  return <View style={styles.rows}>{children}</View>;
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
  banner: {
    backgroundColor: "#2a2213",
    borderColor: theme.colour.warning,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  bannerTitle: {
    color: theme.colour.warning,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  bannerBody: { color: theme.colour.text, lineHeight: 20 },
  card: {
    backgroundColor: theme.colour.surface,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  cardPressed: { opacity: 0.85 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.sm,
  },
  cardHeaderText: { flex: 1, gap: 2 },
  cardTitle: { color: theme.colour.text, fontSize: 17, fontWeight: "600" },
  cardSubtitle: { color: theme.colour.muted },
  cardMeta: { color: theme.colour.muted, fontSize: 12 },
  sectionTitle: {
    color: theme.colour.text,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: theme.space.sm,
  },
  pill: {
    alignSelf: "flex-start",
    backgroundColor: theme.colour.border,
    borderRadius: 999,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
  },
  pillAccent: { backgroundColor: theme.colour.accent },
  pillWarn: { backgroundColor: theme.colour.warning },
  pillText: { color: theme.colour.text, fontSize: 12, fontWeight: "600" },
  pillTextOnAccent: { color: theme.colour.background },
  segmented: {
    flexDirection: "row",
    backgroundColor: theme.colour.background,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: theme.space.xs,
  },
  segmentSelected: { backgroundColor: theme.colour.accent },
  segmentDisabled: { opacity: 0.5 },
  segmentText: { color: theme.colour.muted, fontSize: 14, fontWeight: "600" },
  segmentTextSelected: { color: theme.colour.background },
  rows: {
    backgroundColor: theme.colour.surface,
    borderColor: theme.colour.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md - 4,
    borderBottomColor: theme.colour.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { color: theme.colour.muted },
  rowValue: { color: theme.colour.text, flexShrink: 1, textAlign: "right" },
});
