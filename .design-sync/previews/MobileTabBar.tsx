import { MobileTabBar } from "@club/web";
import { CalendarDays, Home, Menu, MessageSquare, UserCircle } from "lucide-react";

window.__dsPathname = "/messages";

const tabs = [
  { href: "/overview", label: "Home", icon: <Home className="h-5 w-5" />, match: ["/overview"] },
  { href: "/matches", label: "Calendar", icon: <CalendarDays className="h-5 w-5" />, match: ["/matches", "/events"] },
  { href: "/messages", label: "Messages", icon: <MessageSquare className="h-5 w-5" />, match: ["/messages"], badge: 12 },
  { href: "/club", label: "Club", icon: <UserCircle className="h-5 w-5" />, match: ["/club"] },
  { href: "/more", label: "More", icon: <Menu className="h-5 w-5" />, match: ["/more"], moreFallback: true },
];

// The bar is fixed to the bottom of the phone; a transformed, fixed-height
// frame stands in for the phone so it lands inside the card.
export const PhoneBar = () => (
  <div
    className="ds-phone bg-background"
    style={{ width: 390, height: 120, position: "relative", transform: "translateZ(0)", border: "1px solid hsl(30 12% 85%)", borderRadius: 12, overflow: "hidden" }}
  >
    {/* The frame IS the phone: keep the bar visible however wide the card is drawn. */}
    <style>{".ds-phone nav.lg\\:hidden { display: block !important; }"}</style>
    <MobileTabBar tabs={tabs} />
  </div>
);
