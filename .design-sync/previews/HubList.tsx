import { HubList } from "@club/web";
import { CalendarDays, ClipboardCheck, DoorOpen, LandPlot, Landmark, Shirt, Users } from "lucide-react";

export const ClubHub = () => (
  <div style={{ maxWidth: 420 }}>
    <HubList
      sections={[
        {
          section: "Teams",
          rows: [
            { href: "/my-teams", label: "Teams", icon: <Shirt className="h-4 w-4" aria-hidden />, detail: "13 teams across the age groups" },
            { href: "/people", label: "People", icon: <Users className="h-4 w-4" aria-hidden />, detail: "Players, parents, coaches and committee" },
            { href: "/registrations", label: "Registrations", icon: <ClipboardCheck className="h-4 w-4" aria-hidden />, detail: "Awaiting review", badge: 4 },
          ],
        },
        {
          section: "Facilities",
          rows: [
            { href: "/pitches", label: "Pitches", icon: <LandPlot className="h-4 w-4" aria-hidden />, detail: "Allocate fixtures and training" },
            { href: "/room-bookings", label: "Function room", icon: <DoorOpen className="h-4 w-4" aria-hidden />, detail: "Enquiries and hires", badge: 2 },
            { href: "/events", label: "Events", icon: <CalendarDays className="h-4 w-4" aria-hidden /> },
          ],
        },
        {
          section: "Money",
          rows: [{ href: "/finance", label: "Finance", icon: <Landmark className="h-4 w-4" aria-hidden />, detail: "Subs, invoices and payouts" }],
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
            { href: "/matches", label: "Matches", icon: <CalendarDays className="h-4 w-4" aria-hidden />, detail: "3 fixtures, 1 postponed" },
            { href: "/messages", label: "Messages", icon: <Users className="h-4 w-4" aria-hidden />, badge: 120 },
          ],
        },
      ]}
    />
  </div>
);
