import { PlayerToken } from "@club/web";

export const Lineup = () => (
  <div style={{ display: "flex", gap: 16, padding: 16, borderRadius: 12, background: "#2f7d32" }}>
    <PlayerToken name="Amelia Hart" className="h-10 w-10" shirtNumber={1} />
    <PlayerToken name="Noah Bright" className="h-10 w-10" shirtNumber={4} />
    <PlayerToken name="Isla Farrow" className="h-10 w-10" shirtNumber={8} />
    <PlayerToken name="Leo Okafor" className="h-10 w-10" />
  </div>
);

export const Sizes = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <PlayerToken name="Amelia Hart" className="h-8 w-8" />
    <PlayerToken name="Amelia Hart" className="h-10 w-10" shirtNumber={9} />
    <PlayerToken name="Amelia Hart" className="h-14 w-14 text-sm" shirtNumber={9} />
  </div>
);
