import { Tabs } from "expo-router/js-tabs";
import { StyleSheet, Text, type ColorValue } from "react-native";

import { theme } from "../../../lib/theme";

/**
 * The five places the app goes (P7.2, 2026-09-05): Home · Calendar ·
 * Messages · Club · Me — the same five, in the same order, as the web app's
 * sidebar and tab bar. A person who learns one has learned the other.
 *
 * There is no Coach tab any more: a coach's desk is a section of Club,
 * labelled "Coaching · <team>", beside the household's own teams — so a
 * parent who also coaches sees both halves of their week on one screen. The
 * screens behind it hold no authority of their own; every read is the
 * database's answer to THIS caller, and a coach of one team sees one team.
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
          title: "Home",
          tabBarIcon: ({ color }) => <Glyph glyph="🏠" color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color }) => <Glyph glyph="📅" color={color} />,
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
        name="club"
        options={{
          title: "Club",
          tabBarIcon: ({ color }) => <Glyph glyph="👥" color={color} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: "Me",
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
