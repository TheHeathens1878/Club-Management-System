import Link from "next/link";

import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

import { JoinWizard } from "./join-wizard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Join the club",
};

/**
 * The registration page (Adam, 2026-08-24): a player and/or parent registers
 * themselves, then up to six people; more than one becomes a family
 * membership; every player supplies health questions, an emergency contact
 * and a team — or diverts to the waiting list.
 *
 * Public: an anonymous visitor creates their account in step 1. A signed-in
 * member (e.g. from /register earlier) skips account creation and confirms
 * contact details instead.
 */
export default async function JoinPage() {
  const [settings, supabase] = await Promise.all([getSettings(), createClient()]);
  const { data: auth } = await supabase.auth.getUser();

  // The teams a coach can name as they tick (Adam, 2026-09-02). Loaded here
  // rather than in the wizard's own actions because the first step is filled
  // in by somebody who is not signed in yet, and `teams_read` is
  // `to authenticated` — `team_options()` is the door for exactly that.
  const { data: teamRows } = await supabase.rpc("team_options");
  const teams = (teamRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    ageGroup: row.age_group,
  }));

  let defaults: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    /** `people.sex`, so step 2 shows what the club already holds. */
    sex: string | null;
  } = { firstName: "", lastName: "", email: "", phone: "", sex: null };
  if (auth.user) {
    const { data: personId } = await supabase.rpc("current_person_id");
    if (personId) {
      const { data: person } = await supabase
        .from("people")
        .select("first_name,last_name,email,phone,sex")
        .eq("id", personId)
        .maybeSingle();
      if (person) {
        defaults = {
          firstName: person.first_name,
          lastName: person.last_name,
          email: person.email ?? auth.user.email ?? "",
          phone: person.phone ?? "",
          sex: person.sex,
        };
      }
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Join {settings.club_name || "the club"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {auth.user
              ? "Four steps for the whole household: your profile, your children, any adults on your membership, then the registrations."
              : "Your account first — just your name and date of birth — then your profile, your children, any adults on your membership, and the registrations."}
          </p>
          {!auth.user && (
            <p className="mt-2 text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="underline underline-offset-2">
                Sign in
              </Link>{" "}
              first and come back to /join.
            </p>
          )}
        </div>
        <JoinWizard signedIn={!!auth.user} defaults={defaults} teams={teams} />
      </div>
    </main>
  );
}
