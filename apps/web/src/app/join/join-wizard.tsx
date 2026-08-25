"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ShieldCheck, UserPlus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { PHOTO_PREFERENCE_LABELS } from "@/lib/registration-form";
import {
  ID_DOCUMENT_KINDS,
  ID_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  PHOTO_CONSENT_CHOICES,
  PHOTO_MIME_TYPES,
  safeFileName,
  type RegistrationQuestion,
} from "@/lib/registration-questions";
import { createClient } from "@/lib/supabase/client";

import { MAX_HOUSEHOLD } from "./constants";
import {
  joinAddPerson,
  joinFinish,
  joinPlayerDetails,
  joinStart,
  type FinishState,
  type JoinTeamOption,
  type PlayerDetailsState,
  type StartState,
} from "./actions";

type HouseholdPerson = {
  personId: string;
  firstName: string;
  lastName: string;
  dob: string;
  playing: boolean;
  minor: boolean;
  isSelf: boolean;
  needsId: boolean;
};

/**
 * Files go straight to their private bucket from the browser, using the
 * person's OWN client — the storage policy (`can_act_for(<person>)` on the
 * first path segment) is what admits them, exactly as the media album's
 * uploader works. The server action is then handed a PATH, never bytes, and
 * re-checks the ID rule before it accepts the registration.
 */
async function uploadTo(
  bucket: "person-photos" | "identity-documents",
  personId: string,
  file: File,
  accept: string[],
): Promise<{ path: string } | { error: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `${file.name} is larger than 5MB. Please choose a smaller file.` };
  }
  if (file.type && !accept.includes(file.type)) {
    return { error: `${file.name} is not a sort of file the club can accept.` };
  }

  const supabase = createClient();
  const path = `${personId}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) return { error: error.message };
  return { path };
}

type PlayerOutcome = "team" | "waiting_list" | "no_team";

const OUTCOME_LABELS: Record<PlayerOutcome, string> = {
  team: "Team chosen — the club will confirm the registration",
  waiting_list: "Added to the waiting list",
  no_team: "No team yet — the club will be in touch",
};

/**
 * The whole flow lives in client state on one route: people added in step 2
 * accumulate; step 3 renders one panel per player; going back never loses
 * anything already saved to the database (created people and submitted
 * registrations stay — the wizard says so instead of pretending otherwise).
 */
export function JoinWizard({ signedIn, defaults }: {
  signedIn: boolean;
  defaults: { fullName: string; email: string; phone: string };
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [startError, setStartError] = useState<string | null>(null);
  const [registrant, setRegistrant] = useState<StartState["registrant"] | null>(null);
  const [teams, setTeams] = useState<JoinTeamOption[]>([]);
  const [openAgeGroups, setOpenAgeGroups] = useState<string[]>([]);
  const [questions, setQuestions] = useState<RegistrationQuestion[]>([]);
  const [people, setPeople] = useState<HouseholdPerson[]>([]);
  const [registrantContact, setRegistrantContact] = useState({ email: defaults.email, phone: defaults.phone });
  const [pending, startTransition] = useTransition();

  // Step 2 — add-person form state
  const [addError, setAddError] = useState<string | null>(null);

  // Step 3 — per-player outcomes
  const [outcomes, setOutcomes] = useState<Record<string, PlayerOutcome>>({});
  const [playerErrors, setPlayerErrors] = useState<Record<string, string>>({});

  // Step 4
  const [finish, setFinish] = useState<FinishState>({});

  const players = useMemo(() => people.filter((person) => person.playing), [people]);
  const allPlayersDone = players.every((player) => outcomes[player.personId]);

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
      setQuestions(result.questions ?? []);
      const [firstName, ...rest] = result.registrant.fullName.split(" ");
      setRegistrantContact({
        email: String(formData.get("email") ?? defaults.email ?? ""),
        phone: String(formData.get("phone") ?? defaults.phone ?? ""),
      });
      setPeople([
        {
          personId: result.registrant.personId,
          firstName: firstName ?? result.registrant.fullName,
          lastName: rest.join(" "),
          dob: result.registrant.dob,
          playing: result.registrant.playing,
          minor: false,
          isSelf: true,
          needsId: result.registrant.needsId,
        },
      ]);
      setStep(result.registrant.registeringOthers ? 2 : result.registrant.playing ? 3 : 2);
    });
  }

  function submitAddPerson(formData: FormData) {
    formData.set("household_count", String(people.length));
    startTransition(async () => {
      const result = await joinAddPerson({}, formData);
      if (result.error || !result.added) {
        setAddError(result.error ?? "They could not be added.");
        return;
      }
      setAddError(null);
      setPeople((current) => [...current, { ...result.added!, isSelf: false }]);
    });
  }

  function submitPlayer(person: HouseholdPerson, formData: FormData) {
    formData.set("person_id", person.personId);
    formData.set("person_name", `${person.firstName} ${person.lastName}`.trim());
    formData.set("dob", person.dob);
    formData.set("is_self", person.isSelf ? "yes" : "no");
    formData.set("is_minor", person.minor ? "yes" : "no");
    formData.set("registrant_name", registrant?.fullName ?? "");
    formData.set("registrant_email", registrantContact.email);
    formData.set("registrant_phone", registrantContact.phone);
    formData.set("gdpr_asked", questions.some((q) => q.qtype === "gdpr_consent") ? "yes" : "no");
    formData.set(
      "custom_questions",
      JSON.stringify(
        questions
          .filter((question) => !question.system)
          .map((question) => ({
            qkey: question.qkey,
            label: question.label,
            qtype: question.qtype,
            required: question.required,
          })),
      ),
    );

    startTransition(async () => {
      // The two files never reach the server action: they go to their bucket
      // first and the action is handed the paths.
      const photo = formData.get("player_photo_file");
      formData.delete("player_photo_file");
      if (photo instanceof File && photo.size > 0) {
        const result = await uploadTo("person-photos", person.personId, photo, PHOTO_MIME_TYPES);
        if ("error" in result) {
          setPlayerErrors((current) => ({ ...current, [person.personId]: result.error }));
          return;
        }
        formData.set("photo_path", result.path);
      }

      const idFile = formData.get("id_document_file");
      formData.delete("id_document_file");
      if (idFile instanceof File && idFile.size > 0) {
        const result = await uploadTo(
          "identity-documents",
          person.personId,
          idFile,
          ID_MIME_TYPES,
        );
        if ("error" in result) {
          setPlayerErrors((current) => ({ ...current, [person.personId]: result.error }));
          return;
        }
        formData.set("id_path", result.path);
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
  const steps = ["About you", "Your people", "Player details", "Membership"];

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
        <Card>
          <CardHeader>
            <CardTitle>About you</CardTitle>
            <p className="text-sm text-muted-foreground">
              {signedIn
                ? "Confirm your contact details and tell us who you are registering."
                : "This creates your club account. Your date of birth is needed because the club's safeguarding rules depend on knowing who is an adult."}
            </p>
          </CardHeader>
          <CardContent>
            <form action={submitStart} className="space-y-4">
              {!signedIn && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="join-name">Full name</Label>
                      <Input id="join-name" name="full_name" required defaultValue={defaults.fullName} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="join-dob">Date of birth</Label>
                      <Input id="join-dob" name="dob" type="date" required />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="join-email">Email</Label>
                      <Input id="join-email" name="email" type="email" required defaultValue={defaults.email} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="join-phone">Phone</Label>
                      <Input id="join-phone" name="phone" defaultValue={defaults.phone} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="join-password">Password</Label>
                      <Input id="join-password" name="password" type="password" required minLength={8} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="join-confirm">Confirm password</Label>
                      <Input id="join-confirm" name="confirm_password" type="password" required minLength={8} />
                    </div>
                  </div>
                </>
              )}
              {signedIn && (
                <div className="space-y-1">
                  <Label htmlFor="join-phone-in">Phone</Label>
                  <Input id="join-phone-in" name="phone" defaultValue={defaults.phone} />
                </div>
              )}

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Home address</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input name="address_line1" placeholder="Address line 1" required className="sm:col-span-2" />
                  <Input name="address_line2" placeholder="Address line 2 (optional)" className="sm:col-span-2" />
                  <Input name="address_town" placeholder="Town" required />
                  <Input name="address_postcode" placeholder="Postcode" required />
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Who is this membership for?</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="playing" value="yes" defaultChecked className="h-4 w-4" />
                  I will be playing
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="registering_others" value="yes" className="h-4 w-4" />
                  I am registering children or other family members
                </label>
              </fieldset>

              {startError && <p className="text-sm text-destructive">{startError}</p>}
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Continue"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {step === 2 && registrant && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Your people ({people.length} of {MAX_HOUSEHOLD})
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Add everyone this membership covers. One person is an individual membership; two to
              six become a family membership.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1 text-sm">
              {people.map((person) => (
                <li key={person.personId} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-600" />
                  {person.firstName} {person.lastName}
                  {person.isSelf && <span className="text-muted-foreground">(you)</span>}
                  {person.minor && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">child</span>
                  )}
                  {person.playing && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs">playing</span>
                  )}
                </li>
              ))}
            </ul>

            {people.length < MAX_HOUSEHOLD ? (
              <form action={submitAddPerson} className="space-y-3 rounded-lg border p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <UserPlus className="h-4 w-4" /> Add a person
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input name="first_name" placeholder="First name" required />
                  <Input name="last_name" placeholder="Surname" required />
                  <div className="space-y-1">
                    <Label htmlFor="add-dob">Date of birth</Label>
                    <Input id="add-dob" name="dob" type="date" required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="add-email">Email (adults, optional)</Label>
                    <Input id="add-email" name="email" type="email" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="playing" value="yes" defaultChecked className="h-4 w-4" />
                  They will be playing
                </label>
                {addError && <p className="text-sm text-destructive">{addError}</p>}
                <Button type="submit" size="sm" variant="outline" disabled={pending}>
                  {pending ? "Adding…" : "Add"}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                That is the maximum of {MAX_HOUSEHOLD} people for one membership.
              </p>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} disabled={!signedIn && !!registrant}>
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(players.length > 0 ? 3 : 4)} disabled={pending}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <div className="space-y-4">
          {players.map((player) => (
            <PlayerPanel
              key={player.personId}
              player={player}
              questions={questions}
              teams={teams}
              openAgeGroups={openAgeGroups}
              outcome={outcomes[player.personId]}
              error={playerErrors[player.personId]}
              pending={pending}
              onSubmit={(formData) => submitPlayer(player, formData)}
            />
          ))}
          {players.length === 0 && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Nobody in this membership is playing, so there are no player details to collect.
              </CardContent>
            </Card>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(4)} disabled={pending || !allPlayersDone}>
              {allPlayersDone ? "Continue" : "Save every player first"}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
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
                  opens. You can see everything under{" "}
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
                  <Button variant="ghost" size="sm" onClick={() => setStep(players.length > 0 ? 3 : 2)}>
                    <ChevronLeft className="h-4 w-4" /> Back
                  </Button>
                  <Button onClick={submitFinish} disabled={pending}>
                    {pending ? "Submitting…" : "Confirm membership"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * One question, drawn the way the club currently asks it.
 *
 * A SYSTEM question keeps its own hard-coded block — an emergency contact is
 * three fields and photo permissions are four separate SG-5 decisions, and
 * neither survives being flattened into a text box. What the table decides is
 * the ORDER, the WORDING and whether it is required. A question an
 * administrator added is rendered generically and answers to
 * `form.custom.<qkey>`.
 */
function QuestionBlock({
  question,
  player,
}: {
  question: RegistrationQuestion;
  player: HouseholdPerson;
}) {
  const id = `${question.qkey}-${player.personId}`;
  const field = question.system ? question.qkey : `custom_${question.qkey}`;
  const help = question.helpText ? (
    <p className="text-xs text-muted-foreground">{question.helpText}</p>
  ) : null;

  // `can_act_for()` — yourself, or a child you are the guardian of. Another
  // adult in the household is neither, so the storage policy would refuse
  // their photo and their ID. Asking for a file that cannot be accepted is
  // worse than not asking; they upload theirs from their own account.
  const canUpload = player.isSelf || player.minor;

  switch (question.qtype) {
    case "emergency_contact":
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{question.label}</legend>
          {help}
          <div className="grid gap-2 sm:grid-cols-3">
            <Input name="emergency_name" placeholder="Name" required />
            <Input name="emergency_phone" placeholder="Phone" required />
            <Input name="emergency_relationship" placeholder="Relationship" />
          </div>
        </fieldset>
      );

    case "medical":
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{question.label}</legend>
          {help}
          <div className="space-y-1">
            <Label htmlFor={id}>Any medical conditions we should know about?</Label>
            <textarea
              id={id}
              name="medical_conditions"
              rows={2}
              required={question.required}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input name="medical_medication" placeholder="Medication (if any)" />
            <Input name="medical_allergies" placeholder="Allergies (if any)" />
          </div>
        </fieldset>
      );

    case "kit_size":
      return (
        <div className="space-y-1">
          <Label htmlFor={id}>{question.label}</Label>
          {help}
          <select
            id={id}
            name="kit_size"
            required={question.required}
            defaultValue=""
            className="block h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-64 lg:h-10"
          >
            <option value="">Not sure yet</option>
            {question.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );

    case "player_photo":
      if (!canUpload) return null;
      return (
        <div className="space-y-1">
          <Label htmlFor={id}>{question.label}</Label>
          {help}
          <Input
            id={id}
            name="player_photo_file"
            type="file"
            accept={PHOTO_MIME_TYPES.join(",")}
            required={question.required}
            className="h-11 lg:h-10"
          />
        </div>
      );

    case "id_document":
      if (!canUpload) {
        return (
          <p className="text-sm text-muted-foreground">
            {player.firstName} adds their own photo and proof of identity when they sign in.
          </p>
        );
      }
      if (!player.needsId) {
        return (
          <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            The club has already seen ID for this player, so there is nothing to upload.
          </p>
        );
      }
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {question.label} <span className="text-destructive">*</span>
          </legend>
          {help}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-kind`}>What is it?</Label>
              <select
                id={`${id}-kind`}
                name="id_kind"
                defaultValue="birth_certificate"
                className="block h-11 w-full rounded-md border bg-background px-3 text-sm lg:h-10"
              >
                {ID_DOCUMENT_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-file`}>The file</Label>
              <Input
                id={`${id}-file`}
                name="id_document_file"
                type="file"
                accept={ID_MIME_TYPES.join(",")}
                required
                className="h-11 lg:h-10"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Only club administrators can open this file. It is destroyed automatically three years
            after it is uploaded.
          </p>
        </fieldset>
      );

    case "photo_consents":
      if (!canUpload) {
        return (
          <p className="text-sm text-muted-foreground">
            The club asks {player.firstName} about photo permissions directly — an adult&rsquo;s
            permission is theirs to give, not yours.
          </p>
        );
      }
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{question.label}</legend>
          {help}
          {player.isSelf ? (
            <>
              <p className="text-xs text-muted-foreground">
                Tick where you are happy for the club to use photographs of you.
              </p>
              {PHOTO_CONSENT_CHOICES.map((choice) => (
                <label key={choice.field} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={choice.field} value="yes" className="h-4 w-4" />
                  {PHOTO_PREFERENCE_LABELS[
                    choice.field.replace("photo_", "") as keyof typeof PHOTO_PREFERENCE_LABELS
                  ] ?? choice.label}
                </label>
              ))}
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Each of these is a separate decision, and each one you leave unticked is a no. You
                can change any of them later, and they are re-asked every season.
              </p>
              {PHOTO_CONSENT_CHOICES.map((choice) => (
                <label key={choice.field} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={choice.field} value="yes" className="h-4 w-4" />
                  {choice.label}
                </label>
              ))}
            </>
          )}
        </fieldset>
      );

    case "gdpr_consent":
      return (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="gdpr_accepted"
            value="yes"
            required
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="font-medium">{question.label}.</span>{" "}
            {question.helpText ??
              "I have read how the club stores and uses this information."}
          </span>
        </label>
      );

    case "terms":
      return (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="terms_accepted"
            value="yes"
            required
            className="mt-1 h-4 w-4"
          />
          <span>
            {question.helpText ?? "The details are correct and I accept the club’s terms."}
          </span>
        </label>
      );

    case "long_text":
      return (
        <div className="space-y-1">
          <Label htmlFor={id}>{question.label}</Label>
          {help}
          <textarea
            id={id}
            name={field}
            rows={3}
            required={question.required}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
      );

    case "select":
      return (
        <div className="space-y-1">
          <Label htmlFor={id}>{question.label}</Label>
          {help}
          <select
            id={id}
            name={field}
            required={question.required}
            defaultValue=""
            className="block h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-64 lg:h-10"
          >
            <option value="">Choose…</option>
            {question.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );

    case "checkbox":
      return (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name={field}
            value="yes"
            required={question.required}
            className="mt-1 h-4 w-4"
          />
          <span>
            {question.label}
            {question.helpText && (
              <span className="block text-xs text-muted-foreground">{question.helpText}</span>
            )}
          </span>
        </label>
      );

    default:
      return (
        <div className="space-y-1">
          <Label htmlFor={id}>{question.label}</Label>
          {help}
          <Input
            id={id}
            name={field}
            type={
              question.qtype === "date"
                ? "date"
                : question.qtype === "email"
                  ? "email"
                  : question.qtype === "phone"
                    ? "tel"
                    : "text"
            }
            required={question.required}
          />
        </div>
      );
  }
}

function PlayerPanel({
  player,
  questions,
  teams,
  openAgeGroups,
  outcome,
  error,
  pending,
  onSubmit,
}: {
  player: HouseholdPerson;
  questions: RegistrationQuestion[];
  teams: JoinTeamOption[];
  openAgeGroups: string[];
  outcome?: PlayerOutcome;
  error?: string;
  pending: boolean;
  onSubmit: (formData: FormData) => void;
}) {
  const [showAllTeams, setShowAllTeams] = useState(false);

  // A child's plausible teams first; "show all" reveals the rest. Adults see
  // every team straight away.
  const suggested = useMemo(() => {
    if (!player.minor || showAllTeams) return teams;
    const yearOfBirth = Number(player.dob.slice(0, 4));
    return teams.filter((team) => {
      const match = /U(\d{1,2})/i.exec(team.ageGroup ?? "");
      if (!match) return false;
      const under = Number(match[1]);
      const seasonYear = new Date().getFullYear();
      const roughAge = seasonYear - yearOfBirth;
      return under >= roughAge && under <= roughAge + 2;
    });
  }, [player, showAllTeams, teams]);

  if (outcome) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm">
          <Check className="h-4 w-4 text-emerald-600" />
          <span className="font-medium">
            {player.firstName} {player.lastName}:
          </span>{" "}
          {OUTCOME_LABELS[outcome]}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Player details — {player.firstName} {player.lastName}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Health questions and an emergency contact are required for everyone who plays.
        </p>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Team</legend>
            <select
              name="team_choice"
              required
              defaultValue=""
              className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Choose a team…
              </option>
              {suggested.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.ageGroup ? `${team.ageGroup} — ` : ""}
                  {team.name}
                </option>
              ))}
              <option value="waiting_list">No team yet — join the waiting list</option>
            </select>
            {player.minor && !showAllTeams && (
              <button
                type="button"
                onClick={() => setShowAllTeams(true)}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Show all teams
              </button>
            )}
            <div className="space-y-1">
              <Label htmlFor={`sex-${player.personId}`}>
                Biological sex (used for waiting-list and league age groups)
              </Label>
              <select
                id={`sex-${player.personId}`}
                name="biological_sex"
                defaultValue="MALE"
                className="block w-48 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>
            </div>
            {openAgeGroups.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Waiting list currently open for: {openAgeGroups.join(", ")}
              </p>
            )}
          </fieldset>

          {questions.map((question) => (
            <QuestionBlock key={question.id} question={question} player={player} />
          ))}

          {questions.length === 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="terms_accepted" value="yes" required className="mt-1 h-4 w-4" />
              <span>The details are correct and I accept the club&rsquo;s terms.</span>
            </label>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save player"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
