import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";

import { Avatar } from "@/components/avatar";
import { HubList, type HubSection } from "@/components/hub-list";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { itemsFor, linkHref, sectionsOf } from "@/lib/destinations";
import { loadUnreadNotificationCount } from "@/lib/notifications-data";
import { resolveRoleView } from "@/lib/role-view";
import { signPeoplePhotos } from "@/lib/avatars";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Me" };

/**
 * The Me hub (P7.2): the person — profile, family, registering, membership
 * and money, preferences, help — and the way out. Everything a member used
 * to reach through the "You" and "Finance" menu groups, the phone's More
 * screen and the switcher's Me hat is here, once, in the order a new member
 * needs it.
 */
export default async function MePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const capabilities = await getCapabilities();
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const scope = await getTeamScope(view, capabilities);
  const current = { view, teamId: scope?.id ?? null };

  const supabase = await createClient();
  const [{ data: person }, unread] = await Promise.all([
    capabilities.personId
      ? supabase
          .from("people")
          .select("id,first_name,last_name,photo_path")
          .eq("id", capabilities.personId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadUnreadNotificationCount(),
  ]);
  const photos = person?.photo_path ? await signPeoplePhotos([person]) : new Map<string, string>();
  const name = person ? `${person.first_name} ${person.last_name}` : session.profile?.full_name || session.email || "You";

  const sections: HubSection[] = sectionsOf(itemsFor("me", capabilities)).map((section) => ({
    section: section.section,
    rows: section.items.map((item) => ({
      href: linkHref(item, current),
      label: item.label,
      icon: item.icon,
      detail: item.detail,
      badge: item.href === "/notifications" && unread > 0 ? unread : undefined,
    })),
  }));

  return (
    <>
      <PageHeader title="Me" subtitle={session.email ?? undefined} />
      <div className="mx-auto max-w-2xl space-y-5 p-4 lg:p-6">
        <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5">
          <Avatar name={name} photoUrl={person ? photos.get(person.id) ?? null : null} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-snug">{name}</p>
            <p className="truncate text-[12.5px] text-muted-foreground">
              {capabilities.personId ? "Your member record" : "Not linked to a member record yet"}
            </p>
          </div>
        </div>

        <HubList sections={sections} />

        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className={buttonVariants({ variant: "outline" }) + " min-h-[44px] w-full justify-center gap-2"}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </>
  );
}
