import { NavLink } from "@club/web";
import { Contact, Settings, Shirt, Users } from "lucide-react";

window.__dsPathname = "/people";

export const SidebarRows = () => (
  <div className="theme-ink bg-background text-foreground" style={{ width: 240, padding: 12, borderRadius: 12 }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <NavLink href="/my-teams" hrefs={["/my-teams", "/people", "/settings"]}>
        <Shirt className="h-4 w-4" /> Teams
      </NavLink>
      <NavLink href="/people" hrefs={["/my-teams", "/people", "/settings"]} badge={3}>
        <Users className="h-4 w-4" /> People
      </NavLink>
      <NavLink href="/people/parents" child>
        <Contact className="h-3.5 w-3.5" /> Parents
      </NavLink>
      <NavLink href="/settings" lock>
        <Settings className="h-4 w-4" /> Settings
      </NavLink>
    </div>
  </div>
);
