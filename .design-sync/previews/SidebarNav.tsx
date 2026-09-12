import { SidebarNav } from "@club/web";
import { CalendarDays, ClipboardCheck, Home, LandPlot, MessageSquare, Shirt, UserCircle, Users, UsersRound } from "lucide-react";

window.__dsPathname = "/people";

const i = (Icon: typeof Home) => <Icon className="h-4 w-4" />;
const destinations = [
  { key: "home" as const, href: "/overview", label: "Home", icon: i(Home), sections: [] },
  { key: "calendar" as const, href: "/matches", label: "Calendar", icon: i(CalendarDays), sections: [] },
  { key: "messages" as const, href: "/messages", label: "Messages", icon: i(MessageSquare), badge: 12, sections: [] },
  {
    key: "club" as const,
    href: "/club",
    label: "Club",
    icon: i(UsersRound),
    sections: [
      {
        section: "Teams",
        items: [
          { href: "/my-teams", label: "Teams", icon: i(Shirt) },
          { href: "/people", label: "People", icon: i(Users) },
          { href: "/registrations", label: "Registrations", icon: i(ClipboardCheck), badge: 4 },
        ],
      },
      { section: "Facilities", items: [{ href: "/pitches", label: "Pitches", icon: i(LandPlot) }] },
    ],
  },
  { key: "me" as const, href: "/me", label: "Me", icon: i(UserCircle), sections: [] },
];
const hrefs = ["/overview", "/matches", "/messages", "/club", "/my-teams", "/people", "/registrations", "/pitches", "/me"];

export const ClubOpen = () => (
  <div className="theme-ink bg-background text-foreground" style={{ width: 260, padding: 16, borderRadius: 12 }}>
    <SidebarNav destinations={destinations} hrefs={hrefs} />
  </div>
);
