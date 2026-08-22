import { redirect } from "next/navigation";
import { getSessionProfile, isStaff, isBarManager, isCommittee, isBooker } from "@/lib/auth";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { CalendarDays, Clock, LogOut, Settings, Beer } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  // Bookers have no access to the staff area — send them to their portal
  if (isBooker(session.profile?.role)) redirect("/portal");

  const role = session.profile?.role ?? "member";
  const name = session.profile?.full_name || session.email || "User";
  const showBookings = isStaff(role);
  const showBar = isBarManager(role);
  const showSettings = isCommittee(role);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="w-full lg:w-56 border-b lg:border-b-0 lg:border-r bg-card shrink-0">
        <div className="flex lg:flex-col gap-2 p-3 lg:p-4 lg:h-full">
          <div className="hidden lg:block mb-4">
            <p className="text-sm font-semibold">AoM Sports Club</p>
            <p className="text-xs text-muted-foreground truncate">{name}</p>
          </div>

          {showBookings && (
            <div className="flex flex-col gap-0.5">
              <Link
                href="/room-bookings"
                className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
              >
                <CalendarDays className="h-4 w-4" /> Bookings
              </Link>
              <Link
                href="/room-bookings?status=pending&view=list"
                className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2 pl-7 text-muted-foreground text-xs h-7"}
              >
                <Clock className="h-3 w-3" /> Pending
              </Link>
            </div>
          )}

          {showBar && (
            <Link
              href="/bar"
              className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
            >
              <Beer className="h-4 w-4" /> Bar
            </Link>
          )}

          {showSettings && (
            <Link
              href="/settings"
              className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
            >
              <Settings className="h-4 w-4" /> Settings
            </Link>
          )}

          <div className="lg:mt-auto">
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2 w-full"}
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-x-clip bg-background">
        {children}
      </main>
    </div>
  );
}
