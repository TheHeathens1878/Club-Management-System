import { HubList } from "@club/web";
import { CalendarDays, ClipboardCheck, DoorOpen, LandPlot, Landmark, Shirt, Users } from "lucide-react";

export const ClubHub = () => (
  <div style={{ maxWidth: 420 }}>
    <HubList
      sections={[
        {
          section: "Teams",
          rows: [
            { href: "/my-teams", label: "Teams", icon: Shirt, detail: "13 teams across the age groups" },
            { href: "/people", label: "People", icon: Users, detail: "Players, parents, coaches and committee" },
            { href: "/registrations", label: "Registrations", icon: ClipboardCheck, detail: "Awaiting review", badge: 4 },
          ],
        },
        {
          section: "Facilities",
          rows: [
            { href: "/pitches", label: "Pitches", icon: LandPlot, detail: "Allocate fixtures and training" },
            { href: "/room-bookings", label: "Function room", icon: DoorOpen, detail: "Enquiries and hires", badge: 2 },
            { href: "/events", label: "Events", icon: CalendarDays },
          ],
        },
        {
          section: "Money",
          rows: [{ href: "/finance", label: "Finance", icon: Landmark, detail: "Subs, invoices and payouts" }],
        },
      ]}
    />
  </div>
);

export const SingleSection = () => (
  <div style={{ maxWidth: 420 }}>
    <HubList
      sections={[
        {
          section: "This week",
          rows: [
            { href: "/matches", label: "Matches", icon: CalendarDays, detail: "3 fixtures, 1 postponed" },
            { href: "/messages", label: "Messages", icon: Users, badge: 120 },
          ],
        },
      ]}
    />
  </div>
);
