import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, ChevronRight, LogOut, ShieldAlert } from "lucide-react";

import { getSessionProfile } from "@/lib/auth";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { loadUnreadNotificationCount } from "@/lib/notifications-data";
import { MORE_REPORT_HREF, mobileTabsFor, moreScreenGroups } from "@/lib/mobile-nav";
import { navFor, navForUnlinked } from "@/lib/nav";
import { resolveRoleView, roleSwitcherProps } from "@/lib/role-view";
import { RoleSwitcherSheet } from "@/components/role-switcher-sheet";

/**
 * The More screen (Club CRM mobile design): the rest of the sidebar, scoped to
 * the role, with the switcher. A real route rather than a sheet so the back
 * button and deep links behave.
 *
 * Contents, in the design's order: dark band with the Viewing-as tile; the
 * current view's nav groups as white cards of icon rows — minus whatever the
 * tab bar already carries; "Report a concern" pulled out as an accent card
 * ("Open to everyone, in every role" — SG-3: a menu that hides it is a menu
 * that loses the report); notifications; sign out.
 *
 * The page renders on desktop too (harmless beside the sidebar), so no
 * viewport redirect — the tab bar that links here just doesn't exist on lg+.
 */
export default async function MorePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const capabilities = await getCapabilities();
  const storedView = await getStoredRoleView();
  const view = resolveRoleView(storedView, capabilities);
  const groups = view ? navFor(view, capabilities) : navForUnlinked();
  const scope = view ? await getTeamScope(view, capabilities) : null;
  const switcher = view ? roleSwitcherProps(capabilities, view, scope?.id ?? null) : null;
  const unread = await loadUnreadNotificationCount();

  // What the tab bar already shows stays out of the list — except where the
  // group is a numbered flow, which keeps every step. See `moreScreenGroups`.
  const tabHrefs = new Set(mobileTabsFor(view, capabilities).map((tab) => tab.href));
  const listed = moreScreenGroups(groups, tabHrefs);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="theme-ink bg-background px-4 pb-4 pt-4 text-foreground">
        <h1 className="font-display mb-3.5 text-[21px] font-semibold uppercase leading-none tracking-wide">
          More
        </h1>
        {switcher ? (
          <RoleSwitcherSheet
            options={switcher.options}
            current={switcher.current}
            trigger="tile"
          />
        ) : (
          <p className="text-[12.5px] text-foreground/60">
            Signed in as {session.profile?.full_name || session.email}. The club
            has not linked this account to a member record yet.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="overflow-hidden rounded-xl border bg-card">
          <Link
            href="/notifications"
            className="flex min-h-[48px] items-center gap-3 px-4 py-3"
          >
            <Bell className="h-[18px] w-[18px] flex-none text-foreground/75" />
            <span className="flex-1 text-sm">Notifications</span>
            {unread > 0 && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-semibold leading-none text-accent-foreground">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
            <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
          </Link>
        </div>

        {listed.map((group) => (
          <div key={group.group}>
            <p className="font-display mb-2 ml-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {group.group}
            </p>
            <div className="overflow-hidden rounded-xl border bg-card">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex min-h-[48px] items-center gap-3 border-b px-4 py-3 last:border-b-0"
                  >
                    <Icon className="h-[18px] w-[18px] flex-none text-foreground/75" />
                    <span className="flex-1 text-sm">{item.label}</span>
                    <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        <Link
          href={MORE_REPORT_HREF}
          className="flex min-h-[52px] items-center gap-3 rounded-xl border border-accent/40 bg-card px-4 py-3"
        >
          <ShieldAlert className="h-[18px] w-[18px] flex-none text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-tight">Report a concern</span>
            <span className="block text-[11.5px] leading-tight text-muted-foreground">
              Open to everyone, in every role
            </span>
          </span>
          <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
        </Link>

        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left text-sm text-muted-foreground"
          >
            <LogOut className="h-[18px] w-[18px] flex-none" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
