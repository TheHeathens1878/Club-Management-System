import { StatRow, StatTile } from "@club/web";

// The facts band a screen opens with: two across on a phone, four at `lg`.
export const FactsBand = () => (
  <div style={{ maxWidth: 720 }}>
    <StatRow>
      <StatTile label="Sessions" value="24" hint="Tuesdays and Thursdays" />
      <StatTile label="Dates off" value="3" tone="warning" hint="Christmas, Half-term" />
      <StatTile label="Teams" value="7" />
      <StatTile label="Cost" value="£1,296" tone="success" hint="Across the block" />
    </StatRow>
  </div>
);

export const SixAcross = () => (
  <div style={{ maxWidth: 900 }}>
    <StatRow className="lg:grid-cols-6">
      <StatTile label="Enquiries" value="4" />
      <StatTile label="Quoted" value="6" />
      <StatTile label="Pending" value="2" tone="warning" />
      <StatTile label="Confirmed" value="11" tone="success" />
      <StatTile label="Cancelled" value="1" />
      <StatTile label="This month" value="£3,180" />
    </StatRow>
  </div>
);
