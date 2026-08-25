import { redirect } from "next/navigation";
import { LogOut, Menu } from "lucide-react";

import { HeaderTools } from "@/components/header-tools";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile, isBooker } from "@/lib/auth";
import { navFor, navForUnlinked } from "@/lib/nav";
import { NavLink } from "@/components/nav-link";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { loadUnreadNotificationCount } from "@/lib/notifications-data";
import { mobileTabsFor } from "@/lib/mobile-nav";
import { resolveRoleView, roleSwitcherProps } from "@/lib/role-view";
import { MobileHeader } from "@/components/mobile-header";
import { MobileTabBar, type MobileTabItem } from "@/components/mobile-tab-bar";
import { RoleSwitcher } from "@/components/role-switcher";

/**
 * The signed-in shell.
 *
 * The nav is built from two things and no others:
 *
 *   · the person's CAPABILITIES, read from the database under their own RLS —
 *     an item whose capability is false is never rendered, in any view;
 *   · the chosen VIEW, one of the six kinds of user the club recognises. The
 *     scope is hard: the menu is that view's items and nothing else's, and a
 *     person with more than one hat switches between menus rather than seeing
 *     them merged.
 *
 * A cookie naming a view the person does not hold is not honoured and does not
 * produce a banner: `resolveRoleView` simply recomputes and falls back to the
 * widest view they do hold. Somebody who holds none of them gets the two links
 * that are true of any signed-in person, and /welcome explains why.
 *
 * Each page keeps its own guard. This is a menu, not an authorisation layer.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  // Bookers have no access to the staff area — send them to their portal
  if (isBooker(session.profile?.role)) redirect("/portal");

  const name = session.profile?.full_name || session.email || "User";
  const capabilities = await getCapabilities();
  const storedView = await getStoredRoleView();
  const view = resolveRoleView(storedView, capabilities);
  const groups = view ? navFor(view, capabilities) : navForUnlinked();
  // The role–team dropdown (Adam, 2026-08-25): every hat the person holds,
  // team by team. With one option the component renders plain text.
  const scope = view ? await getTeamScope(view, capabilities) : null;
  const switcher = view ? roleSwitcherProps(capabilities, view, scope?.id ?? null) : null;

  // The phone shell (Club CRM mobile design): identity strip on top, a
  // five-slot tab bar underneath — the view's front doors plus More. Icons are
  // rendered here so the capability-scoped list stays a server concern.
  const unread = await loadUnreadNotificationCount();
  const tabs: MobileTabItem[] = mobileTabsFor(view, capabilities).map((tab) => {
    const Icon = tab.icon;
    return {
      href: tab.href,
      label: tab.label,
      icon: <Icon className="h-[21px] w-[21px]" />,
      match: tab.match,
    };
  });
  tabs.push({
    href: "/more",
    label: "More",
    icon: <Menu className="h-[21px] w-[21px]" />,
    match: ["/more"],
    moreFallback: true,
  });

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* The ink rail (crest design): dark sidebar against paper content.
          `.theme-ink` remaps the semantic tokens, so everything inside — the
          bell, ghost buttons, badges — adapts without bespoke styling. On a
          phone the rail does not exist at all: the MobileHeader and the tab
          bar are the shell (mobile design §"the sidebar becomes a tab bar"). */}
      <aside className="theme-ink hidden w-full shrink-0 border-b border-border bg-background text-foreground lg:block lg:w-[232px] lg:border-b-0 lg:border-r">
        <div className="flex gap-2 p-3 lg:h-full lg:flex-col lg:p-4">
          <div className="hidden items-center gap-2.5 border-b border-border pb-3 lg:mb-1 lg:flex">
            {/* The crest is a black shield on a dark rail, so its silhouette
                gets a faint paper rim from drop-shadows on the alpha edge —
                the badge reads without a chip behind it (Adam, 2026-08-25:
                "this white background on the logo … doesn't work"). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/crest.png"
              alt=""
              className="h-[30px] w-auto shrink-0 [filter:drop-shadow(0_0_1px_hsl(34_30%_96%_/_0.9))_drop-shadow(0_0_1px_hsl(34_30%_96%_/_0.6))]"
            />
            <div className="min-w-0">
              <p className="font-display text-[12.5px] font-semibold uppercase leading-tight tracking-wide">
                AoM Sports Club
              </p>
              <p className="truncate text-[11px] text-foreground/55">{name}</p>
            </div>
          </div>

          {/* The switcher now draws its own chip and panel (Adam's screenshot:
              two-line options, tick on the active row) — no wrapper here. */}
          {switcher ? (
            <div className="hidden lg:block">
              <RoleSwitcher options={switcher.options} current={switcher.current} />
            </div>
          ) : null}

          {/* Notifications bell — the notifications entry in every view. */}
          <HeaderTools />

          {groups.map((group) => (
            <div key={group.group} className="flex flex-col gap-0.5">
              {/* Every group carries its eyebrow (design §1.3) — a lone item
                  is still findable under its section name. */}
              <p className="hidden px-3 pb-1 pt-3 font-display text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground lg:block">
                {group.group}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink key={item.href} href={item.href} child={item.child}>
                    <Icon className={item.child ? "h-3 w-3" : "h-4 w-4"} /> {item.label}
                  </NavLink>
                );
              })}
            </div>
          ))}

          <div className="lg:mt-auto">
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className={
                  buttonVariants({ variant: "ghost", size: "sm" }) +
                  " w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
                }
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <MobileHeader
        name={name}
        switcher={switcher ? { options: switcher.options, current: switcher.current } : null}
        unread={unread}
      />

      {/* Bottom padding clears the fixed tab bar (plus the home indicator's
          safe area) so nothing ends underneath it. */}
      <main className="flex-1 overflow-x-clip bg-background pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>

      <MobileTabBar tabs={tabs} />
    </div>
  );
}
