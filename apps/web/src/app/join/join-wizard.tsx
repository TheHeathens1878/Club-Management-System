"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { DateOfBirthInput } from "@/components/date-of-birth-input";
import { TeamPicker, type TeamOption } from "@/components/team-picker";
import { TownCountyFields } from "@/components/town-county-fields";
import { customQuestionsPayload, stageRegistrationUploads } from "@/components/registration-question-block";
import type { RegistrationQuestion } from "@/lib/registration-questions";
import { DEFAULT_MIN_REFEREE_AGE } from "@/lib/referee-age";

import {
  joinAddPerson,
  joinFinish,
  joinPlayerDetails,
  joinSignUp,
  joinStart,
  type FinishState,
  type JoinTeamOption,
  type PlayerDetailsState,
  type RoleAsk,
  type StartState,
} from "./actions";
import { PeopleStep, type HouseholdPerson } from "./people-step";
import { OUTCOME_LABELS, PlayerPanel, type PlayerOutcome } from "./player-panel";

/**
 * Joining the club, in five steps (Adam, 2026-09-02): your account, your
 * profile, your children, your connected adults, the registrations.
 *
 * IT WAS FOUR, AND THE FIRST ONE ASKED FOR THINGS IT COULD NOT KEEP. "I
 * entered my Address and Phone on the first page and said I wanted to coach
 * and referee before confirming my email. When I come back to it after
 * confirming email, I need to re-enter address and phone, and confirm if I
 * want to be coach and a referee. Can the very first page just be to confirm
 * Name and DOB?"
 *
 * Yes, and it is not a bug to patch: `signUp()` returns no session when the
 * address needs confirming, and an address, a phone and a role request all
 * need one. The first page could only ever hold facts that travel inside the
 * sign-up itself — the name and the date of birth — or facts that get thrown
 * away. So the account step asks for exactly the first kind, and the profile
 * step, which now always runs signed in, asks for everything else once.
 *
 * A member who is already signed in starts at step 2 and never sees step 1.
 *
 * The middle two steps were one until 2026-09-01, "your people" — children and
 * adult players added through the same little form. They are not the same
 * thing. A child gets a guardianship recorded and a parent answering for them;
 * a connected adult is a grown-up whose membership happens to sit with yours.
 * Asking separately is what lets each step say what it means, and it is what
 * makes the no-children tick possible.
 *
 * The whole flow lives in client state on one route: people added in steps 3
 * and 4 accumulate; step 5 renders one panel per player and then the
 * membership. Going back never loses anything already saved to the database
 * (created people and submitted registrations stay — the wizard says so
 * instead of pretending otherwise).
 */
export function JoinWizard({ signedIn, defaults, teams: teamOptions }: {
  signedIn: boolean;
  defaults: { firstName: string; lastName: string; email: string; phone: string; sex: string | null };
  /** Every active team, for the coach tick's search box (Adam, 2026-09-02). */
  teams: TeamOption[];
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(signedIn ? 2 : 1);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  /** Set when the sign-up needs the email confirmed before anything else. */
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const [registrant, setRegistrant] = useState<StartState["registrant"] | null>(null);
  const [teams, setTeams] = useState<JoinTeamOption[]>([]);
  const [openAgeGroups, setOpenAgeGroups] = useState<string[]>([]);
  /** Only a club administrator gets the "show all teams" escape (Adam, 2026-08-26). */
  const [isAdmin, setIsAdmin] = useState(false);
  const [minRefereeAge, setMinRefereeAge] = useState(DEFAULT_MIN_REFEREE_AGE);
  const [questions, setQuestions] = useState<RegistrationQuestion[]>([]);
  const [people, setPeople] = useState<HouseholdPerson[]>([]);
  const [registrantContact, setRegistrantContact] = useState({ email: defaults.email, phone: defaults.phone });
  const [pending, startTransition] = useTransition();

  // What the ticks asked for, per step, so a confirmation is shown where the
  // tick was made rather than following the reader around the wizard.
  const [profileRoles, setProfileRoles] = useState<RoleAsk | null>(null);
  const [addedRoles, setAddedRoles] = useState<RoleAsk | null>(null);

  // Steps 3 and 4 — add-person form state
  const [addError, setAddError] = useState<string | null>(null);
  // A possible duplicate on the club's records: the sentence to show, and the
  // post to repeat if the member says it is somebody else (20260825490000).
  const [addConfirm, setAddConfirm] = useState<{ message: string; formData: FormData } | null>(null);
  /** "I have no children to add" (Adam, 2026-09-01). */
  const [noChildren, setNoChildren] = useState(false);

  // Step 5 — per-player outcomes, then the membership
  const [outcomes, setOutcomes] = useState<Record<string, PlayerOutcome>>({});
  const [playerErrors, setPlayerErrors] = useState<Record<string, string>>({});
  const [finish, setFinish] = useState<FinishState>({});

  const children = useMemo(() => people.filter((p) => !p.isSelf && p.minor), [people]);
  const adults = useMemo(() => people.filter((p) => !p.isSelf && !p.minor), [people]);
  const players = useMemo(() => people.filter((person) => person.playing), [people]);
  const allPlayersDone = players.every((player) => outcomes[player.personId]);

  /**
   * Step 1 — create the account, and then stop. Nothing else on this page can
   * be saved until the address is confirmed, which is the whole reason the
   * step is this short.
   */
  function submitAccount(formData: FormData) {
    startTransition(async () => {
      const result = await joinSignUp({}, formData);
      if (result.confirmEmail) {
        setConfirmEmail(result.confirmEmail);
        return;
      }
      if (result.error) {
        setAccountError(result.error);
        return;
      }
      // A session came straight back (email confirmation is switched off):
      // walk on to the profile step rather than sending them to the inbox.
      setAccountError(null);
      setStep(2);
    });
  }

  function submitStart(formData: FormData) {
    startTransition(async () => {
      const result = await joinStart({}, formData);
      if (result.error || !result.registrant) {
        setStartError(result.error ?? "Something went wrong.");
        return;
      }
      setStartError(null);
      setRegistrant(result.registrant);
      setTeams(result.teams ?? []);
      setOpenAgeGroups(result.openAgeGroups ?? []);
      setIsAdmin(result.isAdmin === true);
      setMinRefereeAge(result.minRefereeAge ?? DEFAULT_MIN_REFEREE_AGE);
      setQuestions(result.questions ?? []);
      setProfileRoles(result.roles ?? null);
      // The email is not on this form any more — the account step owns it — so
      // it comes from the record the page was rendered with.
      setRegistrantContact({
        email: defaults.email,
        phone: String(formData.get("phone") ?? defaults.phone ?? ""),
      });
      setPeople([
        {
          personId: result.registrant.personId,
          firstName: result.registrant.firstName,
          lastName: result.registrant.lastName,
          dob: result.registrant.dob,
          playing: result.registrant.playing,
          minor: false,
          isSelf: true,
          needsId: result.registrant.needsId,
          sex: result.registrant.sex,
        },
      ]);
      setStep(3);
    });
  }

  function submitAddPerson(formData: FormData) {
    formData.set("household_count", String(people.length));
    startTransition(async () => {
      const result = await joinAddPerson({}, formData);
      if (result.confirmNew) {
        setAddError(null);
        setAddedRoles(null);
        setAddConfirm({ message: result.confirmNew, formData });
        return;
      }
      if (result.error || !result.added) {
        setAddError(result.error ?? "They could not be added.");
        setAddConfirm(null);
        setAddedRoles(null);
        return;
      }
      setAddError(null);
      setAddConfirm(null);
      setAddedRoles(result.roles ?? null);
      setPeople((current) => [...current, { ...result.added!, isSelf: false, sex: null }]);
    });
  }

  function confirmAddAnyway() {
    if (!addConfirm) return;
    const again = addConfirm.formData;
    again.set("confirm_new", "yes");
    setAddConfirm(null);
    submitAddPerson(again);
  }

  /** Leaving a people step clears its one-off messages. */
  function goToStep(next: 1 | 2 | 3 | 4 | 5) {
    setAddError(null);
    setAddConfirm(null);
    setAddedRoles(null);
    setStep(next);
  }

  function submitPlayer(person: HouseholdPerson, formData: FormData) {
    formData.set("person_id", person.personId);
    formData.set("person_name", `${person.firstName} ${person.lastName}`.trim());
    formData.set("person_first_name", person.firstName);
    formData.set("person_last_name", person.lastName);
    formData.set("dob", person.dob);
    formData.set("is_self", person.isSelf ? "yes" : "no");
    formData.set("is_minor", person.minor ? "yes" : "no");
    formData.set("registrant_name", registrant?.fullName ?? "");
    formData.set("registrant_email", registrantContact.email);
    formData.set("registrant_phone", registrantContact.phone);
    formData.set("gdpr_asked", questions.some((q) => q.qtype === "gdpr_consent") ? "yes" : "no");
    formData.set("custom_questions", customQuestionsPayload(questions));

    startTransition(async () => {
      // The two files never reach the server action: they go to their bucket
      // first and the action is handed the paths.
      const staged = await stageRegistrationUploads(formData, person.personId);
      if ("error" in staged) {
        setPlayerErrors((current) => ({ ...current, [person.personId]: staged.error }));
        return;
      }

      const result: PlayerDetailsState = await joinPlayerDetails({}, formData);
      if (result.error || !result.outcome) {
        setPlayerErrors((current) => ({ ...current, [person.personId]: result.error ?? "Not saved." }));
        return;
      }
      setPlayerErrors((current) => {
        const next = { ...current };
        delete next[person.personId];
        return next;
      });
      setOutcomes((current) => ({ ...current, [person.personId]: result.outcome!.destination }));
    });
  }

  /**
   * Adam, 2026-09-01: a photo over 5MB was refused, "when I chose a different
   * file, the same error message remains and it won't let me click on send
   * registration". The message outlived the file it was about, because it was
   * only ever cleared by a save that succeeded — so the reader fixed the thing
   * and was told it was still broken. It goes the moment they change anything.
   */
  function clearPlayerError(personId: string) {
    setPlayerErrors((current) => {
      if (!(personId in current)) return current;
      const next = { ...current };
      delete next[personId];
      return next;
    });
  }

  function submitFinish() {
    const formData = new FormData();
    for (const person of people) {
      if (!person.isSelf) formData.append("person_id", person.personId);
    }
    startTransition(async () => {
      setFinish(await joinFinish({}, formData));
    });
  }

  // -------------------------------------------------------------------------
  const steps = ["Your account", "Your profile", "Your children", "Connected adults", "Registrations"];

  // The account exists but the address is unconfirmed: that instruction is the
  // whole screen (Adam, 2026-08-25), because nothing else on this page can be
  // done until the link in that email is opened.
  if (confirmEmail) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-1 inline-flex rounded-full bg-emerald-100 p-3 text-emerald-700">
            <MailCheck className="h-7 w-7" />
          </div>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-900">
            Your account is created. Open the confirmation link we have just sent to
            <span className="mt-1 block break-words text-base font-semibold">{confirmEmail}</span>
          </p>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li>1. Open the email and click the confirmation link.</li>
            <li>2. Nothing there? Look in your spam or junk folder.</li>
            <li>3. Sign in, then come back here to finish joining.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            That link brings you straight back to this form at step 2. Your name and date of birth
            are already saved; the rest — your address, what you do at the club, your children and
            your connected adults — is asked once, there, because none of it can be saved until you
            have signed in.
          </p>
          <Link
            href="/login"
            className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Go to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ol className="flex flex-wrap gap-2 text-xs">
        {steps.map((label, index) => (
          <li
            key={label}
            className={
              "rounded-full border px-3 py-1 " +
              (step === index + 1
                ? "border-primary bg-primary text-primary-foreground"
                : step > index + 1
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "text-muted-foreground")
            }
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <AccountStep
          defaults={defaults}
          error={accountError}
          pending={pending}
          onSubmit={submitAccount}
        />
      )}

      {step === 2 && (
        <ProfileStep
          defaults={defaults}
          clubTeams={teamOptions}
          error={startError}
          pending={pending}
          onSubmit={submitStart}
        />
      )}

      {step === 3 && registrant && (
        <>
          {profileRoles && (profileRoles.asked.length > 0 || profileRoles.refused.length > 0) && (
            <div className="space-y-2">
              {profileRoles.asked.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  {profileRoles.asked.map((sentence) => (
                    <li key={sentence}>{sentence}</li>
                  ))}
                </ul>
              )}
              {profileRoles.refused.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {profileRoles.refused.map((sentence) => (
                    <li key={sentence}>{sentence}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <PeopleStep
            kind="child"
            people={children}
            clubTeams={teamOptions}
            householdCount={people.length}
            minRefereeAge={minRefereeAge}
            pending={pending}
            error={addError}
            confirm={addConfirm}
            roles={addedRoles}
            noneTicked={noChildren}
            onNoneChange={setNoChildren}
            onAdd={submitAddPerson}
            onConfirmAnyway={confirmAddAnyway}
            onBack={() => goToStep(2)}
            onContinue={() => goToStep(4)}
          />
        </>
      )}

      {step === 4 && registrant && (
        <PeopleStep
          kind="adult"
          people={adults}
          clubTeams={teamOptions}
          householdCount={people.length}
          minRefereeAge={minRefereeAge}
          pending={pending}
          error={addError}
          confirm={addConfirm}
          roles={addedRoles}
          noneTicked={false}
          onNoneChange={() => {}}
          onAdd={submitAddPerson}
          onConfirmAnyway={confirmAddAnyway}
          onBack={() => goToStep(3)}
          onContinue={() => goToStep(5)}
        />
      )}

      {step === 5 && (
        <div className="space-y-4">
          {players.map((player) => (
            <PlayerPanel
              key={player.personId}
              player={player}
              lead={
                player.isSelf
                  ? null
                  : { name: registrant?.fullName ?? "", phone: registrantContact.phone || null }
              }
              questions={questions}
              teams={teams}
              openAgeGroups={openAgeGroups}
              isAdmin={isAdmin}
              outcome={outcomes[player.personId]}
              error={playerErrors[player.personId]}
              onClearError={() => clearPlayerError(player.personId)}
              pending={pending}
              onSubmit={(formData) => submitPlayer(player, formData)}
            />
          ))}
          {players.length === 0 && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Nobody on this membership is playing, so there is nothing to register. Confirm the
                membership below and the club has everything it needs.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Membership</CardTitle>
              <p className="text-sm text-muted-foreground">
                {people.length > 1
                  ? `Family membership — ${people.length} people.`
                  : "Individual membership — just you."}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-1 text-sm">
                {people.map((person) => (
                  <li key={person.personId} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {person.firstName} {person.lastName}
                    </span>
                    {person.playing ? (
                      <span className="text-muted-foreground">
                        {(() => { const o = outcomes[person.personId]; return o ? OUTCOME_LABELS[o] : "Details not saved"; })()}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Member (not playing)</span>
                    )}
                  </li>
                ))}
              </ul>

              {finish.result ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  <p className="font-medium">
                    {finish.result.kind === "family" ? "Family membership" : "Individual membership"} submitted.
                  </p>
                  <p className="mt-1">
                    The club reviews every registration. Players with a team appear once a club
                    administrator approves them; waiting-list players will be contacted when a place
                    opens. Anybody who asked to coach or referee is waiting on the same desk. You can
                    see everything under{" "}
                    <Link href="/family" className="underline">
                      Children &amp; family
                    </Link>{" "}
                    and{" "}
                    <Link href="/welcome" className="underline">
                      My role
                    </Link>
                    .
                  </p>
                </div>
              ) : (
                <>
                  {finish.error && <p className="text-sm text-destructive">{finish.error}</p>}
                  <div className="flex justify-between">
                    <Button variant="ghost" size="sm" onClick={() => goToStep(4)}>
                      <ChevronLeft className="h-4 w-4" /> Back
                    </Button>
                    <Button onClick={submitFinish} disabled={pending || !allPlayersDone}>
                      {pending
                        ? "Submitting…"
                        : allPlayersDone
                          ? "Confirm membership"
                          : "Save every player first"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * Step 1 — your account. A visitor only, and deliberately five fields.
 *
 * Adam, 2026-09-02: "Can the very first page just be to confirm Name and DOB?"
 * It can, and it should, because a sign-up that needs its address confirmed
 * comes back with no session — so anything asked here beyond what travels
 * inside the sign-up itself is asked twice and kept once. Name and date of
 * birth travel (handle_new_user() reads them); the date of birth cannot wait in
 * any case, because SG-10 decides from it whether this account may exist.
 *
 * Everything else — sex at birth, phone, address, and what you do at the club
 * — is step 2, on the far side of the inbox, where there is a session to save
 * it with.
 */
function AccountStep({
  defaults,
  error,
  pending,
  onSubmit,
}: {
  defaults: { firstName: string; lastName: string; email: string };
  error: string | null;
  pending: boolean;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your account</CardTitle>
        <p className="text-sm text-muted-foreground">
          Your name and your date of birth, and an email address to confirm. The club asks for
          everything else on the next step, once you are signed in — so nothing you type there has
          to be typed twice.
        </p>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Two fields, as /register asked (Adam, 2026-09-01). One
                "Full name" had to be split by rule, and the rule takes the
                last word as the surname — a guess, and wrong for exactly the
                people it is worst to be wrong about. */}
            <div className="space-y-1">
              <Label htmlFor="join-first-name">First name</Label>
              <Input
                id="join-first-name"
                name="first_name"
                required
                autoComplete="given-name"
                defaultValue={defaults.firstName}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="join-last-name">Last name</Label>
              <Input
                id="join-last-name"
                name="last_name"
                required
                autoComplete="family-name"
                defaultValue={defaults.lastName}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="join-dob">Date of birth</Label>
              <DateOfBirthInput id="join-dob" required start="adult" />
              <p className="text-xs text-muted-foreground">
                The club&rsquo;s safeguarding rules depend on knowing who is an adult, so this is
                asked before anything else.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="join-email">Email</Label>
              <Input
                id="join-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                defaultValue={defaults.email}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="join-password">Password</Label>
              <Input
                id="join-password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="join-confirm">Confirm password</Label>
              <Input
                id="join-confirm"
                name="confirm_password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
          </div>

          {error && <p className="whitespace-pre-line text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating your account…" : "Create my account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Step 2 — your profile. Always signed in.
 *
 * Everything the club asks once and everything that needs a session: the sex
 * at birth the FA's records need, the phone, the home address, and the three
 * ticks. Playing is not a request — the registration on step 5 is how somebody
 * becomes a player. The other two are: each one opens a pending request a club
 * administrator decides.
 *
 * The date of birth is already on the record by the time anybody reaches this
 * step, so the referee tick is simply offered and the database's own age guard
 * is what answers.
 */
function ProfileStep({
  defaults,
  clubTeams,
  error,
  pending,
  onSubmit,
}: {
  defaults: { phone: string; sex: string | null };
  clubTeams: TeamOption[];
  error: string | null;
  pending: boolean;
  onSubmit: (formData: FormData) => void;
}) {
  const [coaching, setCoaching] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your profile</CardTitle>
        <p className="text-sm text-muted-foreground">
          Confirm your details and tell us what you do at the club.
        </p>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Adam, 2026-09-01: "biological sex (this is required for the
                FA's records)" — the club cannot enter a player into an age
                group without it. `people.sex` has held these two values since
                20260825500000, and this is where it is asked now: it is not
                one of the facts that survives the trip through the inbox. */}
            <div className="space-y-1">
              <Label htmlFor="join-sex">Biological sex at birth</Label>
              <select
                id="join-sex"
                name="sex"
                required
                defaultValue={defaults.sex ?? ""}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="" disabled>
                  Choose…
                </option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="join-phone">Phone</Label>
              <Input id="join-phone" name="phone" type="tel" autoComplete="tel" defaultValue={defaults.phone} />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Home address</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input name="address_line1" placeholder="Address line 1" required className="sm:col-span-2" />
              <Input name="address_line2" placeholder="Address line 2 (optional)" className="sm:col-span-2" />
              <TownCountyFields idPrefix="join-address" required />
              <Input name="address_postcode" placeholder="Postcode" required />
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">What will you do at the club?</legend>
            <p className="text-xs text-muted-foreground">
              Tick everything that applies, or nothing at all — your children and your connected
              adults are asked about on the next two steps.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="playing" value="yes" defaultChecked className="h-4 w-4" />
              I will be playing
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="coaching"
                value="yes"
                checked={coaching}
                onChange={(event) => setCoaching(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                I coach, or would like to
                <span className="block text-xs text-muted-foreground">
                  A club administrator confirms it before it takes effect.
                </span>
              </span>
            </label>
            {/* The teams, named as the tick is made. More than one, because
                some coach two (Adam, 2026-09-02) — each becomes its own
                request, decided on its own. Not required: somebody
                volunteering before the club has placed them leaves it blank,
                which is what the team-less coach request in 20260901200000 is
                for. */}
            {coaching && (
              <div className="pl-6">
                <TeamPicker
                  id="join-coach-team"
                  name="coach_team_id"
                  teams={clubTeams}
                  multiple
                  label="Which teams do you coach?"
                  help="Add as many as you coach. Leave it blank if you do not know yet — the club will place you."
                />
              </div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="refereeing" value="yes" className="mt-0.5 h-4 w-4" />
              <span>
                I referee, or would like to
                <span className="block text-xs text-muted-foreground">
                  Puts you in the club’s referees group once an administrator confirms it, where
                  games needing a referee are posted. The club registers referees from a set age,
                  and will say so if you are not there yet.
                </span>
              </span>
            </label>
          </fieldset>

          {error && (
            <div className="space-y-1">
              <p className="text-sm text-destructive">{error}</p>
              {/* When what is missing lives on the profile rather than on
                  this form, say where to go AND bring them back — the round
                  trip is the whole point (Adam, 2026-09-01: after saving "it
                  should take you back to the Joining the club workflow"). */}
              {/profile|date of birth/i.test(error) && (
                <a
                  href="/profile?next=/join"
                  className="inline-block text-sm font-medium underline underline-offset-2"
                >
                  Complete your profile, then come straight back here
                </a>
              )}
            </div>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
