"use server";

/**
 * Join the club — the one registration flow (Adam, 2026-08-24), in four steps
 * since 2026-09-01: your profile, your children, your connected adults, the
 * registrations.
 *
 * Authorisation lives in the database throughout:
 *   · the PROFILE step is a Supabase Auth sign-up (handle_new_user() stores
 *     name, DOB, sex, phone and address; the SG-10 guard refuses under-age
 *     accounts), or — already signed in — update_own_contact();
 *   · the CHILDREN and CONNECTED ADULTS steps create people through
 *     add_child() / add_household_adult(), whose SG-4 guards speak for
 *     themselves;
 *   · the REGISTRATIONS step writes a pending `registrations` row per player
 *     (the RLS insert policies cover self, guarded child and household adult)
 *     or diverts to submit_waiting_list_entry(); when the age group is not
 *     open the player still becomes a team-less registration so nobody is ever
 *     lost — and then create_membership(): the fee band is settled by the
 *     number of PLAYERS on the membership in that season, NOT the number of
 *     people on it — a parent registering one child is two people and one
 *     player, so an INDIVIDUAL membership (20260825520000). The people
 *     themselves are still verified against the caller's household by the
 *     function, and there are still at most six of them.
 *
 * THE HATS. Player is not a request — a registration is how somebody becomes
 * a player, and has been since gap 4. Coach and referee are: each tick calls
 * `request_role_for()` (20260901200000), which lands a PENDING account request
 * a club administrator decides in /approvals, and which is the same function
 * whether the tick is beside your own name, a child's or a connected adult's.
 * Nothing in this file grants anybody anything.
 */

import { countyForTown } from "@/lib/address";
import { createClient } from "@/lib/supabase/server";
import { emergencyContactsFromFormData, noEmergencyContacts } from "@/lib/emergency-contacts";
import { saveEmergencyContacts } from "@/lib/emergency-contacts-server";
import { splitContactName } from "@/lib/person-name";
import { DEFAULT_MIN_REFEREE_AGE } from "@/lib/referee-age";
import { registrationFormFromFormData } from "@/lib/registration-form";
import { questionFromRow, type RegistrationQuestion } from "@/lib/registration-questions";
import {
  attachUploads,
  customQuestionsFrom,
  idDocumentOwed,
  submitTeamRegistration,
} from "@/lib/registration-server";
import { getSiteUrl } from "@/lib/utils";
import { ageGroupFromDobString, tidyRpcMessage } from "@/lib/waiting-list";

import { MAX_HOUSEHOLD } from "./constants";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function validDob(dob: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const parsed = new Date(`${dob}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now();
}

// ---------------------------------------------------------------------------
// The hats a tick asks for
// ---------------------------------------------------------------------------

/** What the ticks on one person produced: what was asked, and what was not. */
export type RoleAsk = {
  /** Sentences to show as confirmations — "asked", never "granted". */
  asked: string[];
  /**
   * A refusal, in the database's own words. The commonest is the referee age
   * rule, which names the date the person may ask on — a fact worth showing
   * whole rather than summarising away.
   */
  refused: string[];
};

const EMPTY_ASK: RoleAsk = { asked: [], refused: [] };

/**
 * Ask for the coach and referee hats on one person's behalf.
 *
 * `request_role_for()` decides whether this account may speak for them at all
 * (itself, a guarded child, or a login-less household adult), refuses a
 * referee who is not yet 14, and returns the existing request rather than a
 * duplicate when the form is submitted twice. A null return means the hat is
 * already held, which is not worth a sentence.
 *
 * The coach request carries no team. On the joining form "I coach" is usually
 * said by somebody the club has not placed yet, and 20260901200000 makes the
 * team optional for exactly that: approving grants the club-wide hat and an
 * administrator puts them on a squad from the team page.
 */
async function askForRoles(
  personId: string,
  who: string,
  wants: { coach: boolean; referee: boolean },
): Promise<RoleAsk> {
  const roles: Array<{ role: "coach" | "referee"; sentence: string }> = [];
  if (wants.coach) {
    roles.push({
      role: "coach",
      sentence: `${who} asked to coach — a club administrator will confirm it and put them with a team.`,
    });
  }
  if (wants.referee) {
    roles.push({
      role: "referee",
      sentence: `${who} asked to referee — a club administrator will confirm it.`,
    });
  }
  if (roles.length === 0) return EMPTY_ASK;

  const supabase = await createClient();
  const result: RoleAsk = { asked: [], refused: [] };
  for (const { role, sentence } of roles) {
    const { data, error } = await supabase.rpc("request_role_for", {
      p_person_id: personId,
      p_role: role,
    });
    if (error) {
      result.refused.push(tidyRpcMessage(error.message));
      continue;
    }
    // null: the hat is already held. Nothing was asked and nothing is owed.
    if (data) result.asked.push(sentence);
  }
  return result;
}

/** "You"/their first name, for the sentences above. */
function askedFor(formData: FormData): { coach: boolean; referee: boolean } {
  return {
    coach: formData.get("coaching") === "yes",
    referee: formData.get("refereeing") === "yes",
  };
}

// ---------------------------------------------------------------------------
// Step 1 — about you
// ---------------------------------------------------------------------------

export type JoinTeamOption = {
  id: string;
  name: string;
  ageGroup: string | null;
  /** `teams.gender`: null | "mixed" | "boys" | "girls". A girls' team is for
   *  female players only (Adam, 2026-08-26). */
  gender: string | null;
};

export type StartState = {
  error?: string;
  /** The account exists and the address has to be confirmed before signing in. */
  confirmEmail?: string;
  /** Set on success: the registrant's person id and what step 3 will need. */
  registrant?: {
    personId: string;
    fullName: string;
    firstName: string;
    lastName: string;
    dob: string;
    playing: boolean;
    /** True when the club has neither seen their ID nor holds a document. */
    needsId: boolean;
    /** `people.sex` if the club already holds it. */
    sex: string | null;
  };
  /** What the coach / referee ticks asked for, and what was refused. */
  roles?: RoleAsk;
  teams?: JoinTeamOption[];
  openAgeGroups?: string[];
  /** Only a club administrator is offered "show all teams" (Adam, 2026-08-26). */
  isAdmin?: boolean;
  /** The age the club registers referees from — read, never assumed. */
  minRefereeAge?: number;
  /** The form, as the club currently asks it (live rows, in position order). */
  questions?: RegistrationQuestion[];
};

/**
 * Does this player still owe the club a copy of their ID?
 *
 * `needs_id_document()` answers for the caller's own people only, so a refusal
 * is not an error to show — it is simply "not your question", and the screen
 * asks for the document rather than assuming it is already held.
 */
async function needsIdDocument(personId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("needs_id_document", { p_person_id: personId });
  // A refusal means the caller has no standing over this person — another
  // adult in the household, who uploads their own ID from their own account.
  // Asking them for it here would only produce a storage policy refusal.
  if (error) return false;
  return data === true;
}

/** Teams, open waiting-list age groups, the referee age and the form itself. */
async function loadJoinContext(): Promise<{
  teams: JoinTeamOption[];
  openAgeGroups: string[];
  questions: RegistrationQuestion[];
  isAdmin: boolean;
  minRefereeAge: number;
}> {
  const supabase = await createClient();
  const [teamsResult, groupsResult, questionsResult, adminResult, refereeAgeResult] = await Promise.all([
    supabase.from("teams").select("id,name,age_group,gender").eq("active", true).order("name"),
    supabase.rpc("waiting_list_open_age_groups"),
    supabase
      .from("registration_questions")
      .select("id,qkey,label,help_text,qtype,options,required,system,locked,position,archived_at")
      .is("archived_at", null)
      .order("position"),
    supabase.rpc("is_club_admin"),
    // The club registers referees from this age (20260901160000). Read rather
    // than written down here, so the form and the guard that enforces it
    // cannot come to disagree; 14 is the documented default the function
    // itself falls back to.
    supabase.rpc("safeguarding_setting_int", { p_key: "safeguarding.min_referee_age" }),
  ]);
  return {
    teams: (teamsResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      ageGroup: row.age_group,
      gender: row.gender,
    })),
    openAgeGroups: (groupsResult.data ?? []).map((row) => row.age_group),
    questions: (questionsResult.data ?? [])
      .map((row) => questionFromRow(row))
      .filter((question): question is RegistrationQuestion => question !== null),
    isAdmin: adminResult.data === true,
    minRefereeAge:
      typeof refereeAgeResult.data === "number" && refereeAgeResult.data > 0
        ? refereeAgeResult.data
        : DEFAULT_MIN_REFEREE_AGE,
  };
}

export async function joinStart(_prev: StartState, formData: FormData): Promise<StartState> {
  const playing = formData.get("playing") === "yes";
  const wants = askedFor(formData);
  // No "tick at least one" any more (Adam, 2026-09-01). The four steps ask
  // about children and connected adults in their own right, so somebody who is
  // none of these three things is not making a mistake — they are a committee
  // member who wants a login, which is what /register used to be for and is
  // now this form with everything left unticked.

  const town = text(formData, "address_town");
  const address = {
    line1: text(formData, "address_line1"),
    line2: text(formData, "address_line2"),
    town,
    // The town settles the county where the club knows the place (Adam,
    // 2026-08-25); re-derived rather than trusted from the browser.
    county: countyForTown(town) ?? text(formData, "address_county"),
    postcode: text(formData, "address_postcode"),
  };
  if (!address.line1 || !address.town || !address.postcode) {
    return { error: "Please fill in the first address line, the town and the postcode." };
  }
  const phone = text(formData, "phone");
  const sex = text(formData, "sex").toLowerCase();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (auth.user) {
    // Already signed in (e.g. came from /register earlier): update contact
    // details and read the person back.
    const { error: contactError } = await supabase.rpc("update_own_contact", {
      p_address: address,
      p_phone: phone || undefined,
    });
    if (contactError) return { error: tidyRpcMessage(contactError.message) };

    const { data: personId } = await supabase.rpc("current_person_id");
    if (!personId) return { error: "Your account is not linked to a member record yet." };
    const { data: person } = await supabase
      .from("people")
      .select("first_name,last_name,dob,sex")
      .eq("id", personId)
      .maybeSingle();
    if (!person) return { error: "Your member record could not be read." };
    if (!person.dob) {
      return { error: "Your date of birth is missing — complete your profile first." };
    }
    const context = await loadJoinContext();
    return {
      registrant: {
        personId,
        fullName: `${person.first_name} ${person.last_name}`,
        firstName: person.first_name,
        lastName: person.last_name,
        dob: person.dob,
        playing,
        needsId: await needsIdDocument(personId),
        sex: person.sex,
      },
      roles: await askForRoles(personId, "You", wants),
      ...context,
    };
  }

  // Signed out: this is the account creation, exactly like /register plus the
  // address. SG-10 refusals from the profiles guard come back verbatim.
  const firstName = text(formData, "first_name");
  const lastName = text(formData, "last_name");
  const fullName = `${firstName} ${lastName}`.trim();
  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");
  const dob = text(formData, "dob");

  // The two halves as typed (Adam, 2026-09-01), the same as /register — no
  // recovering a surname from one string by taking its last word.
  if (!firstName) return { error: "Please enter your first name." };
  if (!lastName) return { error: "Please enter your last name." };
  // "Biological sex (this is required for the FA's records)" — the club cannot
  // enter a player into an age group without it.
  if (sex !== "male" && sex !== "female") {
    return { error: "Please choose your biological sex at birth." };
  }
  if (!EMAIL_RE.test(email)) return { error: "Please enter a valid email address." };
  if (password.length < MIN_PASSWORD) {
    return { error: `Please choose a password of at least ${MIN_PASSWORD} characters.` };
  }
  if (password !== confirm) return { error: "The two passwords do not match." };
  if (!validDob(dob)) return { error: "Please enter a valid date of birth." };

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        dob,
        phone: phone || null,
        sex,
        address,
      },
      // The club's own domain, named here rather than left to the project's
      // Site URL (Adam, 2026-08-25: the link pointed at the old Vercel host).
      emailRedirectTo: `${getSiteUrl()}/auth/callback`,
    },
  });
  if (error) {
    // The database's SG-10 message is the explanation; keep it whole.
    if (error.message.includes("SG-10")) return { error: error.message };
    if (/already registered/i.test(error.message)) {
      return { error: "An account with that email already exists — sign in, then come back to /join." };
    }
    return { error: `The account could not be created: ${error.message}` };
  }
  if (!data.session) {
    // Not an error — the account exists. The wizard shows this as its own
    // "check your email" screen (Adam, 2026-08-25), because a line of red
    // text under a form reads as a failure when it is a next step.
    return { confirmEmail: email };
  }

  const { data: personId } = await supabase.rpc("current_person_id");
  if (!personId) return { error: "Your account was created but is not linked to a member record yet." };

  const context = await loadJoinContext();
  return {
    registrant: {
      personId,
      fullName,
      firstName,
      lastName,
      dob,
      playing,
      needsId: await needsIdDocument(personId),
      // A brand-new account: nothing on record yet, so the form asks.
      sex: null,
    },
    roles: await askForRoles(personId, "You", wants),
    ...context,
  };
}

// ---------------------------------------------------------------------------
// Step 2 — your people
// ---------------------------------------------------------------------------

export type AddPersonState = {
  error?: string;
  /**
   * `add_household_adult()` found somebody of that name already on the club's
   * records (20260825490000). A name is not evidence, so nothing is linked and
   * nothing is created: the wizard shows this sentence and offers the two safe
   * answers — go back and give their email address, or say this is a different
   * person and re-post with `confirm_new`.
   */
  confirmNew?: string;
  added?: {
    personId: string;
    firstName: string;
    lastName: string;
    dob: string;
    playing: boolean;
    minor: boolean;
    needsId: boolean;
  };
  /** What the coach / referee ticks beside their name asked for. */
  roles?: RoleAsk;
};

export async function joinAddPerson(_prev: AddPersonState, formData: FormData): Promise<AddPersonState> {
  const firstName = text(formData, "first_name");
  const lastName = text(formData, "last_name");
  const dob = text(formData, "dob");
  const email = text(formData, "email");
  const playing = formData.get("playing") === "yes";
  const count = Number(formData.get("household_count") ?? "1");
  // Which step asked. The database still decides adult from child by the date
  // of birth — this only lets the wrong step say so in its own words instead
  // of forwarding an SG-4 refusal that reads like a fault.
  const step = text(formData, "step"); // "child" | "adult"

  if (!firstName || !lastName) return { error: "Please enter their first name and surname." };
  if (!validDob(dob)) return { error: "Please enter a valid date of birth." };
  if (Number.isFinite(count) && count >= MAX_HOUSEHOLD) {
    return { error: `A membership covers at most ${MAX_HOUSEHOLD} people, including you.` };
  }

  const supabase = await createClient();

  // Eighteen on today's date is the adult/child line the database uses; let
  // the DB decide by trying the age-appropriate entry point. The SG-4
  // refusals ("is an adult — adults create their own account", "add children
  // with add_child()") are shown verbatim when the split disagrees.
  const dobDate = new Date(`${dob}T00:00:00Z`);
  const age = (Date.now() - dobDate.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (step === "child" && age >= 18) {
    return {
      error: `That date of birth makes ${firstName} an adult. Adults go on the next step, Connected adults.`,
    };
  }
  if (step === "adult" && age < 18) {
    return {
      error: `That date of birth makes ${firstName} a child. Go back a step and add them under Your children, so the club records you as their guardian.`,
    };
  }
  const rpc = age < 18 ? "add_child" : "add_household_adult";
  const { data, error } =
    rpc === "add_child"
      ? await supabase.rpc("add_child", { p_first_name: firstName, p_last_name: lastName, p_dob: dob })
      : await supabase.rpc("add_household_adult", {
          p_first_name: firstName,
          p_last_name: lastName,
          p_dob: dob,
          p_email: email || undefined,
          p_confirm_new: formData.get("confirm_new") === "yes",
        });
  // A possible duplicate is not an error: it is a question, and the wizard has
  // an answer for it.
  if (error?.hint === "confirm_new") return { confirmNew: tidyRpcMessage(error.message) };
  if (error || !data) return { error: tidyRpcMessage(error?.message ?? "They could not be added.") };

  return {
    added: {
      personId: data,
      firstName,
      lastName,
      dob,
      playing,
      minor: age < 18,
      needsId: await needsIdDocument(data),
    },
    roles: await askForRoles(data, firstName, askedFor(formData)),
  };
}

// ---------------------------------------------------------------------------
// Step 3 — player details (one call per player)
// ---------------------------------------------------------------------------

export type PlayerDetailsState = {
  error?: string;
  outcome?: { personId: string; destination: "team" | "waiting_list" | "no_team" };
};

export async function joinPlayerDetails(
  _prev: PlayerDetailsState,
  formData: FormData,
): Promise<PlayerDetailsState> {
  const personId = text(formData, "person_id");
  const personName = text(formData, "person_name");
  const dob = text(formData, "dob");
  const isSelf = formData.get("is_self") === "yes";
  const isMinor = formData.get("is_minor") === "yes";
  const teamChoice = text(formData, "team_choice"); // team uuid | "waiting_list"
  if (!personId || !teamChoice) return { error: "Choose a team or the waiting list." };
  if (!text(formData, "biological_sex")) {
    return { error: "Choose whether this player is male or female — the league needs it." };
  }

  // Everything is validated before anything is written.
  const built = registrationFormFromFormData(formData, {
    includePhotoPreferences: isSelf,
    customQuestions: customQuestionsFrom(formData),
    requireGdpr: formData.get("gdpr_asked") === "yes",
  });
  if ("error" in built) return { error: built.error };
  const posted = emergencyContactsFromFormData(formData);
  if ("error" in posted) return { error: posted.error };
  if (noEmergencyContacts(posted)) {
    return { error: "An emergency contact is required for everyone who plays." };
  }
  const owed = await idDocumentOwed(personId, formData);
  if (owed) return { error: owed };

  // Emergency contacts are the person's, not the form's (Adam, 2026-08-25):
  // written to the record first, which is what the registration rule "at
  // least one contact on record" then finds.
  const saved = await saveEmergencyContacts(personId, posted);
  if (saved.error) return { error: saved.error };

  const supabase = await createClient();
  const { data: season } = await supabase
    .from("seasons")
    .select("id,ends_on")
    .eq("is_current", true)
    .maybeSingle();
  if (!season) return { error: "The club has no current season set — please contact the club." };

  if (teamChoice !== "waiting_list") {
    const result = await submitTeamRegistration({
      personId,
      isSelf,
      isMinor,
      seasonId: season.id,
      seasonEndsOn: season.ends_on,
      teamId: teamChoice,
      form: built.form,
      formData,
    });
    if ("error" in result) return { error: result.error };
    return { outcome: { personId, destination: "team" } };
  }

  // Waiting list. The public entry point needs an OPEN age group; when the
  // player's group is not open the person still becomes a team-less pending
  // registration — the club follows up, nobody is dropped.
  const ageGroup = ageGroupFromDobString(dob);
  // `submit_waiting_list_entry()` has always taken the legacy MALE/FEMALE
  // shape; the form now posts lower case, so it is upper-cased here rather
  // than changing an RPC three screens share.
  const sex = (text(formData, "biological_sex") || "male").toUpperCase();
  const parentName = text(formData, "registrant_name");
  const parentEmail = text(formData, "registrant_email");
  const parentPhone = text(formData, "registrant_phone");

  if (ageGroup) {
    const { data: openGroups } = await supabase.rpc("waiting_list_open_age_groups");
    if ((openGroups ?? []).some((row) => row.age_group === ageGroup)) {
      // The waiting list keeps first and last names separately (20260825491000).
      // The wizard already holds both halves for the player; the registrant's
      // display name is split on the last space, the same way the database
      // split the legacy rows.
      const playerParts = splitContactName(personName);
      const parentParts = splitContactName(parentName);
      const { error } = await supabase.rpc("submit_waiting_list_entry", {
        p_player_first_name: text(formData, "person_first_name") || playerParts.firstName,
        p_player_last_name: text(formData, "person_last_name") || playerParts.lastName,
        p_dob: dob,
        p_age_group: ageGroup,
        p_school_year: "",
        p_biological_sex: sex,
        p_team_preference: "",
        p_school: "",
        p_health_conditions: built.form.medical.conditions,
        p_parent_first_name: parentParts.firstName,
        p_parent_last_name: parentParts.lastName,
        p_parent_email: parentEmail,
        p_parent_phone: parentPhone || "—",
        p_coaching_interest: false,
        p_coaching_note: "",
        p_data_consent: true,
      });
      if (!error) {
        // No registration row on this path, so no registration to hang the
        // document off — but the file is already uploaded and a pointer nobody
        // holds is worse than one nobody needs yet.
        await attachUploads(formData, personId, null);
        return { outcome: { personId, destination: "waiting_list" } };
      }
      // fall through to the team-less registration rather than losing them
    }
  }

  const result = await submitTeamRegistration({
    personId,
    isSelf,
    isMinor,
    seasonId: season.id,
    seasonEndsOn: season.ends_on,
    teamId: null,
    form: built.form,
    formData,
    // Recorded so the admin queue can see why this row has no team.
    extraForm: { no_team_note: "No suitable team at joining; waiting list group not open." },
  });
  if ("error" in result) return { error: result.error };
  return { outcome: { personId, destination: "no_team" } };
}

// ---------------------------------------------------------------------------
// Step 4 — membership
// ---------------------------------------------------------------------------

export type FinishState = {
  error?: string;
  result?: { kind: "individual" | "family"; people: number };
};

export async function joinFinish(_prev: FinishState, formData: FormData): Promise<FinishState> {
  const ids = formData
    .getAll("person_id")
    .map((value) => String(value))
    .filter(Boolean);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_membership", { p_person_ids: ids });
  if (error) return { error: tidyRpcMessage(error.message) };
  const row = (data ?? [])[0];
  if (!row) return { error: "The membership could not be recorded." };
  return { result: { kind: row.kind, people: ids.length + 1 } };
}
