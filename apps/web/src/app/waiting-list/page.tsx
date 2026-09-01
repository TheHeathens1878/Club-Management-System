import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { NO_WAITING_LIST_MESSAGE, sortedOpenAgeGroups } from "@/lib/waiting-list";

import { WaitingListForm } from "./waiting-list-form";

/**
 * The public player waiting list (PLAN.md P3.4) — the page that replaces
 * membership.aomsportsclub.co.uk/recruitment when DNS repoints.
 *
 * Unauthenticated: the middleware allow-lists this exact path, and the whole
 * page runs on the anon client. `waiting_list_open_age_groups()` is one of the
 * two functions anon may execute; it returns nothing but the open group names,
 * never an entry.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Join the waiting list",
  description: "Register your child's interest in joining the club.",
};

export default async function PublicWaitingListPage({
  searchParams,
}: {
  searchParams: Promise<{ age_group?: string }>;
}) {
  const supabase = await createClient();
  const [params, { data: groups }, settings] = await Promise.all([
    searchParams,
    supabase.rpc("waiting_list_open_age_groups"),
    getSettings(),
  ]);

  const openAgeGroups = sortedOpenAgeGroups(groups);

  // /recruitment links here with the team's age group. Honour it only if the
  // group is actually open — the database refuses a closed one anyway, and a
  // prefilled field that cannot be submitted is worse than an empty one.
  const requested = params.age_group?.trim() ?? "";
  const initialAgeGroup = openAgeGroups.includes(requested) ? requested : "";

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-accent/10">
      <div className="mx-auto max-w-2xl px-0 sm:px-4 py-6 sm:py-12">
        <div className="mb-8 text-center">
          {settings.logo_url ? (
            <div className="mb-5 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={settings.logo_url}
                alt={settings.logo_alt || "Club logo"}
                style={{
                  height: Math.min(Number(settings.logo_height) || 80, 120),
                  maxWidth: Number(settings.logo_max_width) || 300,
                  objectFit: (settings.logo_object_fit as "contain" | "cover" | "fill") || "contain",
                }}
              />
            </div>
          ) : (
            <div className="mb-4 inline-flex items-center justify-center rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
              {settings.club_name}
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Player waiting list</h1>
          {openAgeGroups.length > 0 && (
            <p className="mx-auto mt-3 max-w-xl text-base text-muted-foreground">
              Register your child&apos;s interest in joining the club. We will be in touch when a
              space comes up in the right age group.
            </p>
          )}
        </div>

        <div className="overflow-hidden rounded-none border-y bg-card sm:rounded-xl sm:border sm:shadow-sm">
          <div className="px-4 py-6 sm:px-6 sm:py-8">
            {openAgeGroups.length === 0 ? (
              <div className="py-8 text-center">
                <p className="mx-auto max-w-md text-base">{NO_WAITING_LIST_MESSAGE}</p>
              </div>
            ) : (
              <>
                <p className="mb-6 text-sm text-muted-foreground">
                  We are currently taking names for{" "}
                  <span className="font-medium text-foreground">{openAgeGroups.join(", ")}</span>.
                </p>
                <WaitingListForm
                  openAgeGroups={openAgeGroups}
                  initialAgeGroup={initialAgeGroup}
                />
              </>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Prefer to speak to someone? Contact us at{" "}
          <a href={`mailto:${settings.contact_email}`} className="text-primary hover:underline">
            {settings.contact_email}
          </a>
          .
        </p>
      </div>
    </main>
  );
}
