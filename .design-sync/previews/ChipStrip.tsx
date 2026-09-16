import { ChipStrip, ToggleChipLink } from "@club/web";

window.__dsPathname = "/my-teams";

// The strip bleeds into the page's own 16px padding, so the first chip starts
// at the text margin and the last runs off the edge — a phone saying there is
// more this way. The frame below stands in for that padded page.
export const Phone = () => (
  <div style={{ width: 390, border: "1px solid hsl(30 12% 85%)", borderRadius: 12, overflow: "hidden" }}>
    <div className="space-y-3 bg-background px-4 py-4">
      <p className="text-row font-semibold leading-tight">Teams</p>
      <ChipStrip>
        <ToggleChipLink href="/my-teams" active>
          All ages
        </ToggleChipLink>
        <ToggleChipLink href="/my-teams?age=u9" active={false} count={2}>
          U9
        </ToggleChipLink>
        <ToggleChipLink href="/my-teams?age=u10" active={false} count={3}>
          U10
        </ToggleChipLink>
        <ToggleChipLink href="/my-teams?age=u11" active={false} count={3}>
          U11
        </ToggleChipLink>
        <ToggleChipLink href="/my-teams?age=u12" active={false} count={2}>
          U12
        </ToggleChipLink>
        <ToggleChipLink href="/my-teams?age=adults" active={false} count={3}>
          Adults
        </ToggleChipLink>
      </ChipStrip>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm">
        <li className="px-4 py-2.5">U11 Venus · 14 players</li>
        <li className="px-4 py-2.5">U12 Jupiter · 16 players</li>
      </ul>
    </div>
  </div>
);
