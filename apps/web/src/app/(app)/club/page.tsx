import { redirect } from "next/navigation";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { HubList, type HubSection } from "@/components/hub-list";
import { PageHeader } from "@/components/page-header";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { itemsFor, linkHref, sectionsOf } from "@/lib/destinations";
import { loadNavCounts, NO_NAV_COUNTS } from "@/lib/nav-counts";
import { resolveRoleView } from "@/lib/role-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Club" };

/**
 * The Club hub (P7.2): your own teams first — one row per hat per team, each
 * opening the team page wearing that hat — then the club's management tools
 * for whoever holds them, under a heading that says so. The rows are the
 * `destinations` table's; this page only draws them.
 */
export default async function ClubPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const capabilities = await getCapabilities();
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const scope = await getTeamScope(view, capabilities);
  const current = { view, teamId: scope?.id ?? null };

  const items = itemsFor("club", capabilities);
  const counts = items.some((item) => item.badge)
    ? await loadNavCounts(capabilities.isClubAdmin)
    : NO_NAV_COUNTS;

  const sections: HubSection[] = sectionsOf(items).map((section) => ({
    section: section.section,
    rows: section.items.map((item) => ({
      href: linkHref(item, current),
      label: item.label,
      icon: item.icon,
      detail: item.detail,
      badge: item.badge && item.badge !== "messages" ? counts[item.badge] || undefined : undefined,
    })),
  }));

  const hasTeams = sections.some((section) => section.section === "Your teams");

  return (
    <>
      <PageHeader
        title="Club"
        subtitle={
          hasTeams
            ? "Your teams, and the club around them"
            : "The club around you — your team appears here once a registration is approved"
        }
      />
      <div className="mx-auto max-w-2xl p-4 lg:p-6">
        {sections.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No team yet"
            action={{ href: "/my-registrations", label: "Register a player" }}
          >
            Your team appears here once a registration is approved. If your sign-in is not linked
            to a member record yet, the club can sort that from your record.
          </EmptyState>
        ) : (
          <HubList sections={sections} />
        )}
      </div>
    </>
  );
}
