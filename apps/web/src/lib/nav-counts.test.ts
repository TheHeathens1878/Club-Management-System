import { describe, expect, it } from "vitest";

import { NAV, type NavBadge } from "@/lib/nav";
import { NO_NAV_COUNTS } from "@/lib/nav-counts";

/**
 * The badge keys and the counter have to stay in step.
 *
 * `NavEntry.badge` names a number that `loadNavCounts` has to produce. If
 * somebody adds a third badge and forgets the query behind it, TypeScript
 * catches the lookup — but not the case where a key is added to `NavCounts`
 * and never counted, or an entry gets a badge whose queue nobody reads. This
 * pins both ends.
 */
describe("nav waiting-counts", () => {
  const badged = NAV.filter((entry) => entry.badge);

  it("counts exactly the two admin queues Adam asked for", () => {
    expect(badged.map((entry) => entry.href).sort()).toEqual(["/approvals", "/registrations"]);
  });

  it("draws them only where a club administrator would see them", () => {
    for (const entry of badged) {
      expect(entry.views).toEqual(["admin"]);
      // The count is the whole club's, so the entry must be admin-gated or the
      // number would be one a member should not be shown.
      expect(entry.allowed({ isClubAdmin: false } as never)).toBe(false);
    }
  });

  it("has a counter behind every badge key, and no counter without a badge", () => {
    const used = new Set<NavBadge>(badged.map((entry) => entry.badge!));
    const counted = new Set(Object.keys(NO_NAV_COUNTS) as NavBadge[]);
    expect([...used].sort()).toEqual([...counted].sort());
  });

  it("starts at zero, so a failed count reads as an empty queue rather than a guess", () => {
    expect(NO_NAV_COUNTS).toEqual({ approvals: 0, registrations: 0 });
  });
});
