import { NounTabs } from "@club/web";

window.__dsPathname = "/pitches/calendar";

export const DiaryTabs = () => (
  <div style={{ maxWidth: 720 }}>
    <NounTabs
      groups={[
        {
          key: "diary",
          tabs: [
            { href: "/events", label: "Your calendar" },
            { href: "/pitches/calendar", label: "Pitch calendar" },
            { href: "/social", label: "Social events" },
            { href: "/matches", label: "Matches desk" },
            { href: "/training", label: "Training" },
            { href: "/pitches", label: "Allocate fixtures", badge: 1 },
          ],
        },
      ]}
    />
  </div>
);
