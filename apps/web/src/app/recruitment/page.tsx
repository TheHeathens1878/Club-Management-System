import Link from "next/link";
import { CalendarClock, Mail, MapPin, Phone, Users } from "lucide-react";

import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import {
  NO_WAITING_LIST_MESSAGE,
  ageGroupSortKey,
  sortedOpenAgeGroups,
} from "@/lib/waiting-list";

/**
 * The public recruitment page (gap 10) — the pitch-booking site's
 * /recruitment, rebuilt.
 *
 * Unauthenticated: the middleware allow-lists the path and the whole page runs
 * on the anon client. `recruiting_teams()` is the only accessor anon holds
 * here, and it is the one that decides what may be shown: it returns active,
 * recruiting teams only, and blanks the contact columns unless that team
 * turned `show_coach_contact` on. This page therefore renders a contact block
 * when one comes back and asks no questions about why — the database has
 * already answered them.
 *
 * "Join the waiting list" carries the age group into the public form, which
 * prefills it. The form still only accepts age groups the club has opened.
 *
 * When the club has no age group ticked "open for new entries", there is no
 * waiting list to send anyone to, so this page stops offering one and says so
 * once, plainly (Adam, 2026-08-25). `waiting_list_open_age_groups()` is the
 * only thing asked — there is no separate flag for "we run a waiting list".
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Join a team",
  description: "The teams currently looking for players, and how to join one.",
};

const JOIN_TYPE_LABELS: Record<string, string> = {
  open: "Open — come along to a session",
  waiting_list: "Waiting list",
  trial: "Trial first",
  closed: "Not taking players right now",
};

const GENDER_LABELS: Record<string, string> = {
  mixed: "Mixed",
  boys: "Boys",
  girls: "Girls",
};

export default async function RecruitmentPage() {
  const supabase = await createClient();
  const [{ data: teamRows }, { data: openRows }, settings] = await Promise.all([
    supabase.rpc("recruiting_teams"),
    supabase.rpc("waiting_list_open_age_groups"),
    getSettings(),
  ]);

  const waitingListOpen = sortedOpenAgeGroups(openRows).length > 0;

  const teams = (teamRows ?? []).slice().sort((a, b) => {
    const byAge = ageGroupSortKey(a.age_group ?? "").localeCompare(ageGroupSortKey(b.age_group ?? ""));
    return byAge !== 0 ? byAge : a.name.localeCompare(b.name);
  });

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-accent/10">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
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
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Join a team</h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-muted-foreground">
            The teams looking for players at the moment, and what to do next for each of them.
          </p>
        </div>

        {teams.length === 0 ? (
          <div className="rounded-xl border bg-card px-6 py-10 text-center">
            <h2 className="text-lg font-semibold">No teams are recruiting right now</h2>
            {waitingListOpen ? (
              <>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Put your child&apos;s name down anyway — we contact the waiting list first when a
                  space opens or a new team starts.
                </p>
                <Link
                  href="/waiting-list"
                  className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Join the waiting list
                </Link>
              </>
            ) : (
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {NO_WAITING_LIST_MESSAGE}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {teams.map((team) => {
              const hasContact = Boolean(
                team.contact_name || team.contact_email || team.contact_phone,
              );
              return (
                <article key={team.id} className="rounded-xl border bg-card p-5 shadow-sm">
                  <header className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{team.name}</h2>
                    {team.age_group && (
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        {team.age_group}
                      </span>
                    )}
                    {team.gender && GENDER_LABELS[team.gender] && (
                      <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs">
                        <Users className="h-3 w-3" /> {GENDER_LABELS[team.gender]}
                      </span>
                    )}
                    {team.join_type && JOIN_TYPE_LABELS[team.join_type] && (
                      <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">
                        {JOIN_TYPE_LABELS[team.join_type]}
                      </span>
                    )}
                  </header>

                  {team.session_details && (
                    <p className="mt-3 flex items-start gap-2 text-sm">
                      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="whitespace-pre-wrap">{team.session_details}</span>
                    </p>
                  )}

                  {team.join_instructions && (
                    <p className="mt-2 flex items-start gap-2 text-sm">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="whitespace-pre-wrap">{team.join_instructions}</span>
                    </p>
                  )}

                  {hasContact && (
                    <div className="mt-3 space-y-1 rounded-lg bg-secondary/40 px-3 py-2 text-sm">
                      {team.contact_name && <p className="font-medium">{team.contact_name}</p>}
                      {team.contact_email && (
                        <p className="flex items-center gap-2">
                          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                          <a
                            href={`mailto:${team.contact_email}`}
                            className="text-primary hover:underline"
                          >
                            {team.contact_email}
                          </a>
                        </p>
                      )}
                      {team.contact_phone && (
                        <p className="flex items-center gap-2">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          <a
                            href={`tel:${team.contact_phone}`}
                            className="text-primary hover:underline"
                          >
                            {team.contact_phone}
                          </a>
                        </p>
                      )}
                    </div>
                  )}

                  {waitingListOpen && (
                    <Link
                      href={
                        team.age_group
                          ? `/waiting-list?age_group=${encodeURIComponent(team.age_group)}`
                          : "/waiting-list"
                      }
                      className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Join the waiting list
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {waitingListOpen ? (
          <p className="mt-8 text-center text-xs text-muted-foreground">
            Not sure which team fits?{" "}
            <Link href="/waiting-list" className="text-primary hover:underline">
              Put your child on the waiting list
            </Link>{" "}
            and we will point you to the right one — or contact us at{" "}
            <a href={`mailto:${settings.contact_email}`} className="text-primary hover:underline">
              {settings.contact_email}
            </a>
            .
          </p>
        ) : (
          <p className="mt-8 text-center text-xs text-muted-foreground">
            {NO_WAITING_LIST_MESSAGE} Not sure which team fits? Contact us at{" "}
            <a href={`mailto:${settings.contact_email}`} className="text-primary hover:underline">
              {settings.contact_email}
            </a>
            .
          </p>
        )}
      </div>
    </main>
  );
}
