import Link from "next/link";
import { redirect } from "next/navigation";
import { Baby, ClipboardCheck, Contact, UserCircle } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { isMemberView, resolveRoleView } from "@/lib/role-view";
import { loadEmergencyContacts } from "@/lib/emergency-contacts-server";
import { formatStamp, personLabel } from "@/lib/people-display";
import { getCurrentPersonId } from "@/lib/person";
import {
  REGISTRATION_STATUS_LABELS,
  registrationStatusVariant,
  type RegistrationStatusValue,
} from "@/lib/registration-form";
import { questionFromRow, type RegistrationQuestion } from "@/lib/registration-questions";
import { createClient } from "@/lib/supabase/server";

import { RegisterForm, WithdrawForm, type TeamOption } from "../family/family-forms";

export const metadata = { title: "Register a player" };

/**
 * Register a player (Adam, 2026-08-25: "change the name of registrations to
 * register a player. Should be able to register themselves, connected adults
 * or children. Currently only allows it from My Children").
 *
 * One screen, and the whole of the joining workflow it belongs to:
 *
 *   1. the household — the caller, the children they are guardian of, and the
 *      connected adults on their account, with the two links that add more;
 *   2. a registration form against ANY of them. The database already admitted
 *      all three: `registrations_self_insert` for the caller,
 *      `registrations_guardian_insert` for a guarded child, and the
 *      household-adult branch of `registrations_guard()` +
 *      `is_household_member_of()` (20260824280000) for a connected adult. The
 *      screen was the only thing that offered it for children alone.
 *   3. where every registration in the household stands.
 *
 * `my_registrations()` (20260824470000) is the status read, and it deliberately
 * does NOT return the form — the medical answers are not a status list's
 * business. This page is not the admin queue: that stays at /registrations
 * under `registrations_admin_read`.
 *
 * Withdraw is offered only where the database would allow it — the subject or
 * an active guardian (`registrations_guard()`), and only while the
 * registration is still PENDING (Adam, 2026-08-25: once it has been granted
 * only an administrator withdraws it). A connected adult's registration is
 * read-only here, because the guard refuses a withdrawal from someone who is
 * neither the subject nor a guardian.
 */

export const dynamic = "force-dynamic";

type Registerable = {
  personId: string;
  /** "Alfie Wareing" — the card's heading. */
  name: string;
  /** "Alfie" — how the form talks about them. */
  firstName: string;
  kind: "self" | "child" | "adult";
  minor: boolean;
};

const KIND_LABELS: Record<Registerable["kind"], string> = {
  self: "You",
  child: "Your child",
  adult: "Connected adult",
};

export default async function RegisterPlayerPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const personId = await getCurrentPersonId();

  const [
    registrationsResult,
    childrenResult,
    householdResult,
    teamsResult,
    seasonsResult,
    questionsResult,
    meResult,
  ] = await Promise.all([
    supabase.rpc("my_registrations"),
    supabase.rpc("my_children"),
    supabase.rpc("my_household"),
    supabase
      .from("teams")
      .select("id,name,age_group,gender,sort_order")
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase.from("seasons").select("id,name,is_current").order("starts_on", { ascending: false }),
    // The registration form as the club currently asks it — the same rows
    // /join and the family screen render.
    supabase
      .from("registration_questions")
      .select("id,qkey,label,help_text,qtype,options,required,system,locked,position,archived_at")
      .is("archived_at", null)
      .order("position"),
    personId
      ? supabase
          .from("people")
          .select("first_name,last_name,preferred_name,is_player")
          .eq("id", personId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const registrations = registrationsResult.data ?? [];
  const children = childrenResult.data ?? [];
  // Connected adults who have no login of their own are the ones this account
  // acts for; an adult with their own sign-in registers themselves.
  const household = (householdResult.data ?? []).filter(
    (adult) => adult.is_adult && !adult.has_login,
  );
  const teams: TeamOption[] = (teamsResult.data ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    ageGroup: team.age_group,
    gender: team.gender,
  }));
  const currentSeason = (seasonsResult.data ?? []).find((season) => season.is_current) ?? null;
  const questions: RegistrationQuestion[] = (questionsResult.data ?? [])
    .map((row) => questionFromRow(row))
    .filter((question): question is RegistrationQuestion => question !== null);

  // Everyone this account may register, in the order the workflow adds them.
  const people: Registerable[] = [];
  // Adam, 2026-08-26: you appear here only if you have said you play. The tick
  // is on My Profile; children and connected adults are registered by somebody
  // else and are listed whatever the caller ticked about themselves.
  if (personId && meResult.data?.is_player === true) {
    const me = meResult.data;
    people.push({
      personId,
      name: personLabel(me),
      firstName: me.preferred_name || me.first_name,
      kind: "self",
      minor: false,
    });
  }
  for (const child of children) {
    people.push({
      personId: child.person_id,
      name: personLabel(child),
      firstName: child.preferred_name || child.first_name,
      kind: "child",
      minor: child.is_minor,
    });
  }
  for (const adult of household) {
    people.push({
      personId: adult.person_id,
      name: `${adult.first_name} ${adult.last_name}`.trim(),
      firstName: adult.first_name,
      kind: "adult",
      minor: false,
    });
  }

  // What each of them still owes the club: an emergency contact on the record,
  // and proof of identity unless the club has already seen it. Both are asked
  // of the database as the caller — a refusal means "not your question", and
  // `needs_id_document()` then answers false rather than raising.
  const subjectIds = people.map((person) => person.personId);
  const contactsByPerson = await loadEmergencyContacts(subjectIds);
  const needsIdByPerson = new Map(
    await Promise.all(
      subjectIds.map(async (id) => {
        const { data } = await supabase.rpc("needs_id_document", { p_person_id: id });
        return [id, data === true] as const;
      }),
    ),
  );

  // The date of birth the age band comes from and the sex already on record,
  // for everyone this account may register — including the login-less
  // household adults, whose `people` rows the caller cannot read directly.
  const { data: subjectFacts } = await supabase.rpc("registration_subjects", {
    p_person_ids: subjectIds,
  });
  const factsByPerson = new Map(
    (subjectFacts ?? []).map((row) => [row.person_id, { dob: row.dob, sex: row.sex }] as const),
  );
  // "Show all teams" is a club administrator's escape and nobody else's
  // (Adam, 2026-08-26).
  // …and only under an administrator's hat (Adam, 2026-09-02). Registering a
  // child from the parent view offers the two age bands every other parent
  // gets, not the whole club's team list.
  const isAdmin =
    isCommittee(session.profile?.role) &&
    !isMemberView(resolveRoleView(await getStoredRoleView(), await getCapabilities()));

  const childIds = new Set(children.map((child) => child.person_id));

  // One card per person, in the order the function returns them (newest
  // first), with the caller's own card labelled.
  const byPerson = new Map<string, { name: string; isSelf: boolean; rows: typeof registrations }>();
  for (const row of registrations) {
    const entry = byPerson.get(row.person_id);
    if (entry) entry.rows.push(row);
    else byPerson.set(row.person_id, { name: row.person_name, isSelf: row.is_self, rows: [row] });
  }

  // The first-run workflow: somebody who has just signed up has themselves and
  // nobody else, and nothing registered. The steps say what the club needs
  // next rather than leaving them on an empty page.
  const showSteps = registrations.length === 0;

  return (
    <>
      <PageHeader
        title="Register a player"
        subtitle="Register yourself, a child or a connected adult — and see where every registration stands"
      />

      <div className="space-y-6 p-4 lg:p-6">
        {registrationsResult.error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {registrationsResult.error.message}
          </p>
        )}

        {showSteps && (
          <Card className="border-accent/40">
            <CardHeader className="p-4 lg:p-6">
              <CardTitle className="text-base">Joining the club</CardTitle>
              <p className="text-sm text-muted-foreground">
                Four steps, in this order. Everything after the first is optional — register
                whoever plays, and skip the rest.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
              <ol className="space-y-3 text-sm">
                <li className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">1. Your own details</span>
                  <span className="text-muted-foreground">
                    — contact details and an emergency contact.
                  </span>
                  <Link
                    href="/profile"
                    className={
                      buttonVariants({ variant: "outline", size: "sm" }) +
                      " min-h-[44px] lg:min-h-0"
                    }
                  >
                    <UserCircle className="h-4 w-4" /> My profile
                  </Link>
                </li>
                <li className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">2. Add your children</span>
                  <span className="text-muted-foreground">— one card each, with their details.</span>
                  <Link
                    href="/family"
                    className={
                      buttonVariants({ variant: "outline", size: "sm" }) +
                      " min-h-[44px] lg:min-h-0"
                    }
                  >
                    <Baby className="h-4 w-4" /> My children
                  </Link>
                </li>
                <li className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">3. Add connected adults</span>
                  <span className="text-muted-foreground">
                    — another parent, a grandparent, anyone the club should know.
                  </span>
                  <Link
                    href="/connected-adults"
                    className={
                      buttonVariants({ variant: "outline", size: "sm" }) +
                      " min-h-[44px] lg:min-h-0"
                    }
                  >
                    <Contact className="h-4 w-4" /> Connected adults
                  </Link>
                </li>
                <li>
                  <span className="font-medium">4. Register whoever plays</span>
                  <span className="text-muted-foreground"> — below, one form each.</span>
                </li>
              </ol>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Who is playing?</CardTitle>
            <p className="text-sm text-muted-foreground">
              A registration is one person, one season, one team. A club administrator confirms it
              and can move the team if the age group is wrong.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0">
            {people.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody to register yet. If you play yourself, tick{" "}
                <Link href="/profile" className="underline underline-offset-2">
                  I am a player
                </Link>{" "}
                on My profile; otherwise add a child or a connected adult below.
              </p>
            ) : (
              people.map((person) => (
                <div key={person.personId} className="rounded-lg border p-4">
                  <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
                    {person.name}
                    <Badge variant="outline">{KIND_LABELS[person.kind]}</Badge>
                  </p>
                  <RegisterForm
                    personId={person.personId}
                    personName={person.name}
                    firstName={person.firstName}
                    minor={person.minor}
                    needsId={needsIdByPerson.get(person.personId) ?? true}
                    contactsOnRecord={(contactsByPerson.get(person.personId) ?? []).length}
                    seasonId={currentSeason?.id ?? null}
                    seasonName={currentSeason?.name ?? null}
                    teams={teams}
                    questions={questions}
                    dob={factsByPerson.get(person.personId)?.dob ?? null}
                    recordedSex={factsByPerson.get(person.personId)?.sex ?? null}
                    isAdmin={isAdmin}
                    isSelf={person.kind === "self"}
                  />
                </div>
              ))
            )}
            <p className="text-xs text-muted-foreground">
              Somebody missing? Add a child on{" "}
              <Link href="/family" className="underline underline-offset-2">
                My children
              </Link>{" "}
              or an adult on{" "}
              <Link href="/connected-adults" className="underline underline-offset-2">
                Connected adults
              </Link>
              , and they appear here.
            </p>
          </CardContent>
        </Card>

        {byPerson.size === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nothing registered yet — the forms above are where it starts.
            </CardContent>
          </Card>
        ) : (
          Array.from(byPerson.entries()).map(([subjectId, entry]) => (
            <Card key={subjectId}>
              <CardHeader className="p-4 lg:p-6">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <ClipboardCheck className="h-4 w-4" />
                  {entry.name}
                  {entry.isSelf && <Badge variant="outline">You</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
                <ul className="space-y-2">
                  {entry.rows.map((row) => {
                    const status = row.status as RegistrationStatusValue;
                    // Adam, 2026-08-25: a family withdraws while it is still
                    // waiting; once the club has approved it, only a club
                    // administrator can. `registrations_guard()` is what
                    // enforces that — this only stops offering a button the
                    // database would refuse.
                    const canWithdraw =
                      (entry.isSelf || childIds.has(subjectId)) && status === "pending";
                    return (
                      <li
                        key={row.registration_id}
                        className="rounded-md border bg-card px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-full font-medium lg:w-auto">
                            {row.team_name ?? "No team requested"}
                          </span>
                          <Badge variant="outline">{row.season_name}</Badge>
                          <Badge variant={registrationStatusVariant(status)}>
                            {REGISTRATION_STATUS_LABELS[status]}
                          </Badge>
                          <span className="w-full text-xs text-muted-foreground lg:ml-auto lg:w-auto">
                            Sent {formatStamp(row.submitted_at)}
                          </span>
                        </div>
                        {canWithdraw && (
                          <div className="mt-2">
                            <WithdrawForm registrationId={row.registration_id} />
                          </div>
                        )}
                        {status === "approved" && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Approved — ask a club administrator to withdraw.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
