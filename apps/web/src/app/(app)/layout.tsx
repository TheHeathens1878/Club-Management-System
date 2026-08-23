import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";

import { HeaderTools } from "@/components/header-tools";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile, isBooker } from "@/lib/auth";
import { navFor, navForUnlinked } from "@/lib/nav";
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
      <aside className="w-full shrink-0 border-b bg-card lg:w-56 lg:border-b-0 lg:border-r">
        <div className="flex gap-2 p-3 lg:h-full lg:flex-col lg:p-4">
          <div className="hidden lg:mb-4 lg:block">
            <p className="text-sm font-semibold">AoM Sports Club</p>
            <p className="truncate text-xs text-muted-foreground">{name}</p>
            {view ? (
              <Link
                href="/welcome"
                className="mt-1 inline-block text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {ROLE_VIEW_LABELS[view]}
                {canSwitch ? " · change" : ""}
              </Link>
            ) : null}
          </div>

          {/* Notifications bell — the notifications entry in every view. */}
          <HeaderTools />

          {groups.map((group) => (
            <div key={group.group} className="flex flex-col gap-0.5">
              {group.items.length > 1 ? (
                <p className="hidden px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:block">
                  {group.group}
                </p>
              ) : null}
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      buttonVariants({ variant: "ghost", size: "sm" }) +
                      (item.child
                        ? " h-7 justify-start gap-2 pl-7 text-xs text-muted-foreground"
                        : " justify-start gap-2")
                    }
                  >
                    <Icon className={item.child ? "h-3 w-3" : "h-4 w-4"} /> {item.label}
                  </Link>
                );
              })}
            </div>
          ))}

          <div className="lg:mt-auto">
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className={
                  buttonVariants({ variant: "ghost", size: "sm" }) + " w-full justify-start gap-2"
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
