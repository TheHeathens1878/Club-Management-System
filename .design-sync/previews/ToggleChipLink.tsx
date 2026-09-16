import { ChipStrip, ToggleChipLink } from "@club/web";

window.__dsPathname = "/events";
window.__dsSearch = "type=match";

export const Variants = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
    <ToggleChipLink href="/events" active={false}>
      Everything
    </ToggleChipLink>
    <ToggleChipLink href="/events?type=match" active count={8}>
      Matches
    </ToggleChipLink>
    <ToggleChipLink href="/events?type=training" active={false} count={16}>
      Training
    </ToggleChipLink>
    <ToggleChipLink href="/events?type=social" active={false} count={3} size="sm">
      Socials
    </ToggleChipLink>
  </div>
);

// Every filter worth sharing is a URL: the chip is a link, so the narrowed
// list can be sent to a colleague and Back undoes the tap.
export const InContext = () => (
  <div style={{ maxWidth: 420 }} className="space-y-3 px-4">
    <ChipStrip>
      <ToggleChipLink href="/events" active={false}>
        Everything
      </ToggleChipLink>
      <ToggleChipLink href="/events?type=match" active count={8}>
        Matches
      </ToggleChipLink>
      <ToggleChipLink href="/events?type=training" active={false} count={16}>
        Training
      </ToggleChipLink>
      <ToggleChipLink href="/events?type=social" active={false} count={3}>
        Socials
      </ToggleChipLink>
    </ChipStrip>
    <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm">
      <li className="px-4 py-2.5">Sun 14 Sep · U11 Venus v Sale United · Carrington</li>
      <li className="px-4 py-2.5">Sun 14 Sep · U12 Jupiter v Urmston Town · Away</li>
    </ul>
  </div>
);
