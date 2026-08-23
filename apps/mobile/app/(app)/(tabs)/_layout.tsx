import { Tabs } from "expo-router/js-tabs";
import { StyleSheet, Text, type ColorValue } from "react-native";

import { theme } from "../../../lib/theme";

/**
 * The five things a club member opens the app for. Order is deliberate: teams
 * and fixtures are the daily read, subs and messages the weekly one, profile
 * the rare one.
 *
 * Icons are glyphs rather than an icon font: one fewer asset pipeline to get
 * wrong before P6.4, and they scale with the platform's text size.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.colour.background },
        headerTintColor: theme.colour.text,
        sceneStyle: { backgroundColor: theme.colour.background },
        tabBarStyle: {
          backgroundColor: theme.colour.surface,
          borderTopColor: theme.colour.border,
        },
        tabBarActiveTintColor: theme.colour.accent,
        tabBarInactiveTintColor: theme.colour.muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "My teams",
          tabBarIcon: ({ color }) => <Glyph glyph="👥" color={color} />,
        }}
      />
      <Tabs.Screen
        name="fixtures"
        options={{
          title: "Fixtures",
          tabBarIcon: ({ color }) => <Glyph glyph="⚽" color={color} />,
        }}
      />
      <Tabs.Screen
        name="subs"
        options={{
          title: "Subs",
          tabBarIcon: ({ color }) => <Glyph glyph="💷" color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarIcon: ({ color }) => <Glyph glyph="💬" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <Glyph glyph="👤" color={color} />,
        }}
      />
    </Tabs>
  );
}

function Glyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={[styles.glyph, { color }]}>{glyph}</Text>;
}

const styles = StyleSheet.create({
  glyph: { fontSize: 18 },
});
