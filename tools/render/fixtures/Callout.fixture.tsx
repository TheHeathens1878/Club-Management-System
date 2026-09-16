/**
 * The four tints, with and without a title, plus the long-message case: a
 * guard's refusal arrives as several lines and must wrap inside the box
 * rather than widen it.
 */

import { AlertCircle } from "lucide-react";

import { Callout } from "@/components/ui/callout";

import type { Fixture } from "./contract";

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl space-y-3 p-4">{children}</div>;
}

const fixture: Fixture = {
  cases: {
    tones: () => (
      <Frame>
        <Callout tone="info">Fixtures, training and socials share one diary, so a clash cannot hide in another list.</Callout>
        <Callout tone="success">Winter 2026/27 is on the calendar — 8 sessions added, 2 changed.</Callout>
        <Callout tone="warning" title="1 clash this week">
          Banky Lane 1 has two bookings at 18:00 on Tuesday.
        </Callout>
        <Callout tone="danger" icon={<AlertCircle className="h-4 w-4" aria-hidden />}>
          U11 Venus is already in Banky Lane 1 18:00–19:00.
        </Callout>
      </Frame>
    ),

    longMessage: () => (
      <Frame>
        <Callout tone="danger" className="whitespace-pre-line">
          {
            "Banky Lane cannot come off this block:\n3 slots are still at that venue — Tuesday 18:00, Tuesday 19:00 and Thursday 18:00. Move or remove them first."
          }
        </Callout>
      </Frame>
    ),
  },
};

export default fixture;
