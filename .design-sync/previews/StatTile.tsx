import { StatRow, StatTile } from "@club/web";
import { Receipt } from "lucide-react";

export const Variants = () => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, maxWidth: 420 }}>
    <StatTile label="Total" value="£420.00" />
    <StatTile label="Paid" value="£220.00" tone="success" hint="Deposit and balance" />
    <StatTile label="Outstanding" value="£200.00" tone="danger" hint="Due 28 October" />
    <StatTile
      label="Payments"
      value="3"
      icon={<Receipt className="h-3.5 w-3.5" aria-hidden />}
      href="/room-bookings/1/payments"
    />
  </div>
);

export const InContext = () => (
  <div style={{ maxWidth: 720 }}>
    <StatRow>
      <StatTile label="Registered" value="142" hint="of 168 on the books" />
      <StatTile label="Awaiting DOB" value="26" tone="warning" hint="No FA age band yet" href="/people?missing=dob" />
      <StatTile label="Subs collected" value="£8,240" tone="success" hint="This season" />
      <StatTile label="Outstanding" value="£1,840" tone="danger" hint="3 over 60 days" href="/finance/charges" />
    </StatRow>
  </div>
);
