"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/types";
import {
  LayoutDashboard,
  Users,
  Tags,
  Receipt,
  UserCircle,
  LogOut,
  ShieldCheck,
  ClipboardList,
  Search,
  Settings,
  Bell,
  Menu,
  X,
  ScrollText,
  Mail,
  CreditCard,
  CalendarDays,
  FileText,
  CalendarRange,
  DoorOpen,
  GlassWater,
} from "lucide-react";
import { NoticeBell } from "@/components/notice-bell";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["super_user", "committee", "bar"] },
  { href: "/year-end", label: "Year-end", icon: CalendarRange, roles: ["super_user", "committee"] },
  { href: "/members", label: "Members", icon: Users, roles: ["super_user", "committee", "bar"] },
  { href: "/applications", label: "Applications", icon: ClipboardList, roles: ["super_user", "committee", "bar"] },
  { href: "/payments", label: "Payments", icon: Receipt, roles: ["super_user", "committee", "bar"] },
  { href: "/communications", label: "Communications", icon: Mail, roles: ["super_user", "committee"] },
  { href: "/categories", label: "Categories", icon: Tags, roles: ["super_user", "committee"] },
  { href: "/events", label: "Club Events", icon: CalendarDays, roles: ["super_user", "committee", "bar", "member"] },
  { href: "/room-bookings", label: "Room Bookings", icon: DoorOpen, roles: ["super_user", "committee", "bar"] },
  { href: "/bar-signin", label: "Bar Sign-in Log", icon: GlassWater, roles: ["super_user", "committee", "bar"] },
  { href: "/email-templates", label: "Email Templates", icon: FileText, roles: ["super_user", "committee"] },
  { href: "/noticeboard", label: "Noticeboard", icon: Bell, roles: ["super_user", "committee", "bar", "member"] },
  { href: "/audit", label: "Audit Log", icon: ScrollText, roles: ["super_user", "committee"] },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["super_user"] },
  { href: "/account", label: "My membership", icon: UserCircle, roles: ["super_user", "committee", "bar", "member"] },
] as const;

type NoticePost = { id: string; title: string; created_at: string; pinned: boolean };
type UpcomingEvent = { id: string; title: string; start_at: string; location: string | null; created_at: string };

export function AppNav({ role, name, noticePosts, upcomingEvents = [], logoUrl, logoAlt = "Club logo" }: {
  role: UserRole;
  name: string;
  noticePosts: NoticePost[];
  upcomingEvents?: UpcomingEvent[];
  logoUrl?: string | null;
  logoAlt?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  // Year-end flow is seasonal — only show Oct, Nov, Dec, Jan
  const yearEndMonth = new Date().getMonth(); // 0-indexed
  const showYearEnd = [9, 10, 11, 0].includes(yearEndMonth);

  const items = NAV.filter((n) => {
    if (n.href === "/year-end" && !showYearEnd) return false;
    return (n.roles as readonly string[]).includes(role);
  });
  const canSearchMembers = role === "super_user" || role === "committee" || role === "bar";

  useEffect(() => { setOpen(false); }, [pathname]);

  function handleSearch(value: string) {
    const q = value.trim();
    router.push(q ? `/members?q=${encodeURIComponent(q)}` : "/members");
    setOpen(false);
  }

  const sidebarContent = (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={logoAlt} style={{ height: 36, maxWidth: 36, objectFit: "contain", flexShrink: 0 }} />
        ) : (
          <div className="inline-flex rounded-lg bg-primary/10 p-2 text-primary shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
        )}
        <div className="leading-tight min-w-0">
          <p className="text-sm font-semibold truncate">AoM Sports Club</p>
          <p className="text-xs text-muted-foreground">Function Room Hire</p>
        </div>
        {/* Close button — mobile only */}
        <button onClick={() => setOpen(false)} className="ml-auto rounded-md p-1 text-muted-foreground hover:text-foreground lg:hidden">
          <X className="h-5 w-5" />
        </button>
      </div>

      {canSearchMembers && (
        <div className="border-b px-3 py-2 hidden lg:block">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search members…"
              className="w-full rounded-md border bg-background py-1.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch((e.target as HTMLInputElement).value);
              }}
            />
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <div className="mb-2 flex items-center gap-2 px-3 py-1">
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-xs capitalize text-muted-foreground">{role}</p>
          </div>
          <NoticeBell posts={noticePosts} events={upcomingEvents} />
        </div>
        <Link
          href="/card"
          className="mb-1 flex w-full items-center gap-3 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <CreditCard className="h-4 w-4" />
          My membership card
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center gap-2 border-b bg-card px-3 py-2 lg:hidden">
        <button onClick={() => setOpen(true)} className="rounded-md p-2 text-muted-foreground hover:bg-secondary">
          <Menu className="h-5 w-5" />
        </button>

        {canSearchMembers && (
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search members…"
              className="w-full rounded-md border bg-background py-1.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch((e.target as HTMLInputElement).value);
              }}
            />
          </div>
        )}

        {!canSearchMembers && (
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">USC Sale</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/card"
            title="My membership card"
            className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <CreditCard className="h-3.5 w-3.5" />
            My card
          </Link>
          <NoticeBell posts={noticePosts} events={upcomingEvents} fixed />
        </div>
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside
            className="absolute inset-y-0 left-0 flex w-64 flex-col bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card lg:flex">
        {sidebarContent}
      </aside>

      {/* Mobile spacer so content isn't behind the fixed top bar */}
      <div className="h-14 shrink-0 lg:hidden" />
    </>
  );
}
