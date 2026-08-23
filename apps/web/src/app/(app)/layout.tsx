import { redirect } from "next/navigation";
import { getSessionProfile, isStaff, isBarManager, isCommittee, isBooker } from "@/lib/auth";
import { hasWaitingListAccess, isClubAdmin, isSafeguardingLead } from "@/lib/person";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  CalendarDays,
  ClipboardList,
  Clock,
  Contact,
  LogOut,
  Settings,
  Beer,
  Users,
  LandPlot,
  MessageSquare,
  Receipt,
  ShieldAlert,
  Images,
  Wallet,
} from "lucide-react";

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
  // Teams, seasons and the Full-Time links are committee-and-above (P2.3).
  const showTeams = isCommittee(role);
  // The safeguarding desk is the lead's, plus club administrators (SG-3, SG-9).
  // `person_roles` is the authority on the lead, not `profiles.role`.
  // The waiting list desk (P3.4) is a club administrator's, plus any coach
  // holding a `waiting_list_access` grant — RLS returns nothing to anyone
  // else, so there is no point offering them the link.
  const [lead, admin, waitingListAccess] = await Promise.all([
    isSafeguardingLead(),
    isClubAdmin(),
    hasWaitingListAccess(),
  ]);
  const showSafeguarding = lead || isCommittee(role);
  const showWaitingList = admin || waitingListAccess;

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

          {showTeams && (
            <Link
              href="/teams"
              className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
            >
              <Users className="h-4 w-4" /> Teams
            </Link>
          )}

          {/* The member records the teams are built from. Same audience as
              Teams: `people` RLS answers to club_admin / safeguarding_lead,
              which is what a committee sign-in holds. */}
          {showTeams && (
            <Link
              href="/people"
              className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
            >
              <Contact className="h-4 w-4" /> People
            </Link>
          )}

          {/* Pitch allocation (P2.5) sits with Teams — same audience, and the
              fixtures it allocates are the ones the Teams screens import. */}
          {showTeams && (
            <Link
              href="/pitches"
              className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
            >
              <LandPlot className="h-4 w-4" /> Pitches
            </Link>
          )}

          {showWaitingList && (
            <Link
              href="/waiting-list/manage"
              className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
            >
              <ClipboardList className="h-4 w-4" /> Waiting list
            </Link>
          )}

          {/* Messages are for everyone with a member record (P5.4). */}
          <Link
            href="/messages"
            className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
          >
            <MessageSquare className="h-4 w-4" /> Messages
          </Link>

          <div className="flex flex-col gap-0.5">
            {showSettings && (
              <Link
                href="/subs"
                className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
              >
                <Receipt className="h-4 w-4" /> Subs
              </Link>
            )}
            <Link
              href="/my-subs"
              className={
                buttonVariants({ variant: "ghost", size: "sm" }) +
                (showSettings
                  ? " justify-start gap-2 pl-7 text-muted-foreground text-xs h-7"
                  : " justify-start gap-2")
              }
            >
              <Wallet className={showSettings ? "h-3 w-3" : "h-4 w-4"} /> My subs
            </Link>
          </div>

          <div className="flex flex-col gap-0.5">
            {showSafeguarding && (
              <Link
                href="/safeguarding"
                className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
              >
                <ShieldAlert className="h-4 w-4" /> Safeguarding
              </Link>
            )}
            {/* Reporting a concern is open to everyone (SG-3). */}
            <Link
              href="/safeguarding/report"
              className={
                buttonVariants({ variant: "ghost", size: "sm" }) +
                (showSafeguarding
                  ? " justify-start gap-2 pl-7 text-muted-foreground text-xs h-7"
                  : " justify-start gap-2")
              }
            >
              <ShieldAlert className={showSafeguarding ? "h-3 w-3" : "h-4 w-4"} /> Report a concern
            </Link>
          </div>

          <Link
            href="/media"
            className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
          >
            <Images className="h-4 w-4" /> Media
          </Link>

          <div className="flex flex-col gap-0.5">
            {showSettings && (
              <Link
                href="/settings"
                className={buttonVariants({ variant: "ghost", size: "sm" }) + " justify-start gap-2"}
              >
                <Settings className="h-4 w-4" /> Settings
              </Link>
            )}
            <Link
              href="/settings/comms"
              className={
                buttonVariants({ variant: "ghost", size: "sm" }) +
                (showSettings
                  ? " justify-start gap-2 pl-7 text-muted-foreground text-xs h-7"
                  : " justify-start gap-2")
              }
            >
              <MessageSquare className={showSettings ? "h-3 w-3" : "h-4 w-4"} /> Comms
            </Link>
          </div>

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
