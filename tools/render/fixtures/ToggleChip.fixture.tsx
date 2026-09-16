/**
 * The filter pills, and the strip they live in on a phone.
 *
 * The strip case is the one that matters at 390: seven day chips in one line
 * that scrolls sideways must not make the PAGE scroll sideways, which is
 * exactly the difference between `overflow-x-auto` on the strip and a row
 * that simply overflows. The harness's second assertion is the test.
 */

import { ChipStrip } from "@/components/ui/chip-strip";
import { ToggleChip, ToggleChipLink } from "@/components/ui/toggle-chip";

import type { Fixture } from "./contract";

const DAYS = [
  { label: "Mon", count: 4 },
  { label: "Tue", count: 6 },
  { label: "Wed", count: 2 },
  { label: "Thu", count: 5 },
  { label: "Fri", count: 0 },
  { label: "Sat", count: 1 },
  { label: "Sun", count: 3 },
];

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl space-y-4 p-4">{children}</div>;
}

const fixture: Fixture = {
  cases: {
    // A day chosen, the rest waiting — the block page's own chip row.
    strip: () => (
      <Frame>
        <ChipStrip>
          <ToggleChip on={false}>Week</ToggleChip>
          {DAYS.map((day) => (
            <ToggleChip key={day.label} on={day.label === "Tue"} count={day.count}>
              {day.label}
            </ToggleChip>
          ))}
        </ChipStrip>
      </Frame>
    ),

    // The link twin: a filter that lives in the URL.
    links: () => (
      <Frame>
        <ChipStrip>
          <ToggleChipLink href="/events" active>
            Everything
          </ToggleChipLink>
          <ToggleChipLink href="/events?kind=fixture" active={false} count={12}>
            Fixtures
          </ToggleChipLink>
          <ToggleChipLink href="/events?kind=training" active={false} count={30}>
            Training
          </ToggleChipLink>
          <ToggleChipLink href="/events?kind=social" active={false} size="sm">
            Socials
          </ToggleChipLink>
        </ChipStrip>
      </Frame>
    ),
  },
};

export default fixture;
