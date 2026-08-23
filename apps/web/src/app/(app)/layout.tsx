import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";

import { HeaderTools } from "@/components/header-tools";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile, isBooker } from "@/lib/auth";
import { navFor } from "@/lib/nav";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { ROLE_VIEW_LABELS, defaultRoleView, qualifiesForView } from "@/lib/role-view";

/**
 * The signed-in shell.
 *
 * The nav is built from two things and no others (gap 4):
 *
 *   · the person's CAPABILITIES, read from the database under their own RLS —
 *     an item whose capability is false is never rendered, in any view;
 *   · the chosen VIEW, a cookie preference that groups the nav for a player, a
 *     parent, a coach or an administrator. It is presentation only. Someone
 *     may choose a view they do not hold (they may be waiting on an approval),
 *     and then they get the banner below rather than a menu full of links that
 *     would bounce them back out.
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
  const view = storedView ?? defaultRoleView(capabilities);
  const groups = navFor(view, capabilities);
  const qualifies = qualifiesForView(view, capabilities);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="w-full shrink-0 border-b bg-card lg:w-56 lg:border-b-0 lg:border-r">
        <div className="flex gap-2 p-3 lg:h-full lg:flex-col lg:p-4">
          <div className="hidden lg:mb-4 lg:block">
            <p className="text-sm font-semibold">AoM Sports Club</p>
            <p className="truncate text-xs text-muted-foreground">{name}</p>
            <Link
              href="/welcome"
              className="mt-1 inline-block text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {ROLE_VIEW_LABELS[view]} view · change
            </Link>
          </div>

          {/* Notifications bell (gap 5) + pitch calendar link (gap 6). */}
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

      <main className="flex-1 overflow-x-clip bg-background">
        {qualifies ? null : (
          <div className="border-b bg-amber-50 px-8 py-3 text-sm text-amber-900">
            You are looking at the {ROLE_VIEW_LABELS[view].toLowerCase()} view, but the club has not
            recorded that role for you yet — so only what your account can actually reach is listed.{" "}
            <Link href="/welcome" className="font-medium underline">
              Ask to be approved
            </Link>
            .
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
