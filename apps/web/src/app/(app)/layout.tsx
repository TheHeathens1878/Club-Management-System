import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";

import { HeaderTools } from "@/components/header-tools";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile, isBooker } from "@/lib/auth";
import { navFor, navForUnlinked } from "@/lib/nav";
import { NavLink } from "@/components/nav-link";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { ROLE_VIEW_LABELS, qualifiedViews, resolveRoleView } from "@/lib/role-view";

/**
 * The signed-in shell.
 *
 * The nav is built from two things and no others:
 *
 *   · the person's CAPABILITIES, read from the database under their own RLS —
 *     an item whose capability is false is never rendered, in any view;
 *   · the chosen VIEW, one of the five kinds of user the club recognises. The
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
  // Only worth offering "change" when there is something to change to.
  const canSwitch = qualifiedViews(capabilities).length > 1;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* The ink rail (crest design): dark sidebar against paper content.
          `.theme-ink` remaps the semantic tokens, so everything inside — the
          bell, ghost buttons, badges — adapts without bespoke styling. */}
      <aside className="theme-ink w-full shrink-0 border-b border-border bg-background text-foreground lg:w-60 lg:border-b-0 lg:border-r">
        <div className="flex gap-2 p-3 lg:h-full lg:flex-col lg:p-4">
          <div className="hidden items-center gap-2.5 border-b border-border pb-3 lg:mb-1 lg:flex">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/crest.png" alt="" className="h-9 w-auto" />
            <div className="min-w-0">
              <p className="font-display text-[13px] font-semibold uppercase leading-tight tracking-wide">
                AoM Sports Club
              </p>
              <p className="truncate text-xs text-muted-foreground">{name}</p>
            </div>
          </div>

          {view ? (
            <div className="hidden rounded-lg border border-accent/40 bg-accent/15 px-3 py-2 lg:block">
              <p className="font-display text-[9px] font-medium uppercase tracking-[0.16em] text-accent">
                Viewing as
              </p>
              <Link
                href="/welcome"
                className="mt-0.5 inline-block text-[13px] font-semibold underline-offset-2 hover:underline"
              >
                {ROLE_VIEW_LABELS[view]}
                {canSwitch ? <span className="font-normal text-muted-foreground"> · change</span> : null}
              </Link>
            </div>
          ) : null}

          {/* Notifications bell — the notifications entry in every view. */}
          <HeaderTools />

          {groups.map((group) => (
            <div key={group.group} className="flex flex-col gap-0.5">
              {group.items.length > 1 ? (
                <p className="hidden px-3 pb-1 pt-3 font-display text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground lg:block">
                  {group.group}
                </p>
              ) : null}
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

      <main className="flex-1 overflow-x-clip bg-background">{children}</main>
    </div>
  );
}
