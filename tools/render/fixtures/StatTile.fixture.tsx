/**
 * The facts band. Two across on a phone and four on a desk, so the case
 * worth photographing is six tiles with money in them: the figures must line
 * up digit under digit and a long currency string must not widen a column.
 */

import { Receipt } from "lucide-react";

import { StatRow, StatTile } from "@/components/ui/stat-tile";

import type { Fixture } from "./contract";

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl space-y-4 p-4">{children}</div>;
}

const fixture: Fixture = {
  cases: {
    band: () => (
      <Frame>
        <StatRow>
          <StatTile label="Outstanding" value="£1,284.50" href="/finance/charges" />
          <StatTile label="Overdue" value="£240.00" tone="danger" href="/finance/reports" />
          <StatTile label="Collected this month" value="£3,912.00" icon={<Receipt className="h-3.5 w-3.5" aria-hidden />} />
          <StatTile label="Memberships numbered" value="113" hint="of 128 people" />
        </StatRow>
      </Frame>
    ),

    tones: () => (
      <Frame>
        <StatRow className="lg:grid-cols-3">
          <StatTile label="Season total" value="£1,840.00" />
          <StatTile label="Sessions booked" value={148} hint="6 not charged" />
          <StatTile label="Slots without a price" value={3} tone="warning" />
        </StatRow>
      </Frame>
    ),
  },
};

export default fixture;
