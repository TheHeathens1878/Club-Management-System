import { useState } from "react";
import { ChipStrip, ToggleChip } from "@club/web";

const DAYS = [
  { key: "tue", label: "Tue", count: 4 },
  { key: "wed", label: "Wed", count: 0 },
  { key: "thu", label: "Thu", count: 6 },
  { key: "sat", label: "Sat", count: 11 },
];

export const Variants = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
    <ToggleChip on>Thursday</ToggleChip>
    <ToggleChip on={false}>Tuesday</ToggleChip>
    <ToggleChip on count={6}>Thursday</ToggleChip>
    <ToggleChip on={false} count={11}>
      Saturday
    </ToggleChip>
    <ToggleChip on={false} size="sm">
      Compact
    </ToggleChip>
    <ToggleChip on={false} disabled>
      Sunday
    </ToggleChip>
  </div>
);

// The day chips on the training timetable: they change only what is drawn, so
// the state is local. A filter that should be shareable is a ToggleChipLink.
export const InContext = () => {
  const [day, setDay] = useState("thu");
  return (
    <div style={{ maxWidth: 420 }} className="space-y-3 px-4">
      <ChipStrip>
        {DAYS.map((entry) => (
          <ToggleChip key={entry.key} on={day === entry.key} count={entry.count} onClick={() => setDay(entry.key)}>
            {entry.label}
          </ToggleChip>
        ))}
      </ChipStrip>
      <p className="text-sm text-muted-foreground">
        Showing the busiest day first, because that is the one somebody opened the page to fix.
      </p>
    </div>
  );
};
