"use server";

/**
 * Join the club — the one registration flow (Adam, 2026-08-24).
 *
 * Four server actions, one per wizard step. Authorisation lives in the
 * database throughout:
 *   · step 1 is a Supabase Auth sign-up (handle_new_user() stores name, DOB,
 *     phone and address; the SG-10 guard refuses under-age accounts), or —
 *     already signed in — update_own_contact();
 *   · step 2 creates household people through add_child() / add_household_adult(),
 *     whose SG-4 guards speak for themselves;
 *   · step 3 writes a pending `registrations` row per player (the RLS insert
 *     policies cover self, guarded child and household adult) or diverts to
 *     submit_waiting_list_entry(); when the age group is not open the player
 *     still becomes a team-less registration so nobody is ever lost;
 *   · step 4 is create_membership(): one person → individual, two to six →
 *     family, verified against the caller's household by the function.
 */

import { createClient } from "@/lib/supabase/server";
import {
  registrationFormFromFormData,
  REGISTRATION_FORM_VERSION,
} from "@/lib/registration-form";
import { ageGroupFromDob, tidyRpcMessage } from "@/lib/waiting-list";

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
// Step 1 — about you
// ---------------------------------------------------------------------------

export type JoinTeamOption = { id: string; name: string; ageGroup: string | null };

export type StartState = {
  error?: string;
  /** Set on success: the registrant's person id and what step 3 will need. */
  registrant?: {
    personId: string;
    fullName: string;
    dob: string;
    playing: boolean;
    registeringOthers: boolean;
  };
  teams?: JoinTeamOption[];
  openAgeGroups?: string[];
};

/** Teams + open waiting-list age groups, readable once signed in. */
async function loadJoinContext(): Promise<{ teams: JoinTeamOption[]; openAgeGroups: string[] }> {
  const supabase = await createClient();
  const [teamsResult, groupsResult] = await Promise.all([
    supabase.from("teams").select("id,name,age_group").eq("active", true).order("name"),
    supabase.rpc("waiting_list_open_age_groups"),
  ]);
  return {
    teams: (teamsResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      ageGroup: row.age_group,
    })),
    openAgeGroups: (groupsResult.data ?? []).map((row) => row.age_group),
  };
}

export async function joinStart(_prev: StartState, formData: FormData): Promise<StartState> {
  const playing = formData.get("playing") === "yes";
  const registeringOthers = formData.get("registering_others") === "yes";
  if (!playing && !registeringOthers) {
    return { error: "Tick at least one: playing yourself, or registering family members." };
  }

  const address = {
    line1: text(formData, "address_line1"),
    line2: text(formData, "address_line2"),
    town: text(formData, "address_town"),
    postcode: text(formData, "address_postcode"),
  };
  if (!address.line1 || !address.town || !address.postcode) {
    return { error: "Please fill in the first address line, the town and the postcode." };
  }
  const phone = text(formData, "phone");

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
      .select("first_name,last_name,dob")
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
        dob: person.dob,
        playing,
        registeringOthers,
      },
      ...context,
    };
  }

  // Signed out: this is the account creation, exactly like /register plus the
  // address. SG-10 refusals from the profiles guard come back verbatim.
  const fullName = text(formData, "full_name");
  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");
  const dob = text(formData, "dob");

  if (fullName.length < 2 || !fullName.includes(" ")) {
    return { error: "Please enter your first name and surname." };
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
    options: { data: { full_name: fullName, dob, phone: phone || null, address } },
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
    return {
      error:
        "Your account was created but needs email confirmation. Confirm it, sign in, and come back to /join to finish.",
    };
  }

  const { data: personId } = await supabase.rpc("current_person_id");
  if (!personId) return { error: "Your account was created but is not linked to a member record yet." };

  const context = await loadJoinContext();
  return {
    registrant: { personId, fullName, dob, playing, registeringOthers },
    ...context,
  };
}

// ---------------------------------------------------------------------------
// Step 2 — your people
// ---------------------------------------------------------------------------

export type AddPersonState = {
  error?: string;
  added?: { personId: string; firstName: string; lastName: string; dob: string; playing: boolean; minor: boolean };
};

export async function joinAddPerson(_prev: AddPersonState, formData: FormData): Promise<AddPersonState> {
  const firstName = text(formData, "first_name");
  const lastName = text(formData, "last_name");
  const dob = text(formData, "dob");
  const email = text(formData, "email");
  const playing = formData.get("playing") === "yes";
  const count = Number(formData.get("household_count") ?? "1");

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
  const rpc = age < 18 ? "add_child" : "add_household_adult";
  const { data, error } =
    rpc === "add_child"
      ? await supabase.rpc("add_child", { p_first_name: firstName, p_last_name: lastName, p_dob: dob })
      : await supabase.rpc("add_household_adult", {
          p_first_name: firstName,
          p_last_name: lastName,
          p_dob: dob,
          p_email: email || undefined,
        });
  if (error || !data) return { error: tidyRpcMessage(error?.message ?? "They could not be added.") };

  return {
    added: { personId: data, firstName, lastName, dob, playing, minor: age < 18 },
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
  const teamChoice = text(formData, "team_choice"); // team uuid | "waiting_list"
  if (!personId || !teamChoice) return { error: "Choose a team or the waiting list." };

  const built = registrationFormFromFormData(formData, { includePhotoPreferences: isSelf });
  if ("error" in built) return { error: built.error };

  const supabase = await createClient();
  const { data: season } = await supabase
    .from("seasons")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  if (!season) return { error: "The club has no current season set — please contact the club." };

  if (teamChoice !== "waiting_list") {
    const { error } = await supabase.from("registrations").insert({
      person_id: personId,
      season_id: season.id,
      team_id: teamChoice,
      form: JSON.parse(JSON.stringify(built.form)),
      form_version: REGISTRATION_FORM_VERSION,
    });
    if (error) return { error: tidyRpcMessage(error.message) };
    return { outcome: { personId, destination: "team" } };
  }

  // Waiting list. The public entry point needs an OPEN age group; when the
  // player's group is not open the person still becomes a team-less pending
  // registration — the club follows up, nobody is dropped.
  const ageGroup = validDob(dob) ? ageGroupFromDob(new Date(`${dob}T00:00:00Z`)) : null;
  const sex = text(formData, "biological_sex") || "MALE";
  const parentName = text(formData, "registrant_name");
  const parentEmail = text(formData, "registrant_email");
  const parentPhone = text(formData, "registrant_phone");

  if (ageGroup) {
    const { data: openGroups } = await supabase.rpc("waiting_list_open_age_groups");
    if ((openGroups ?? []).some((row) => row.age_group === ageGroup)) {
      const { error } = await supabase.rpc("submit_waiting_list_entry", {
        p_player_name: personName,
        p_dob: dob,
        p_age_group: ageGroup,
        p_school_year: "",
        p_biological_sex: sex,
        p_team_preference: "",
        p_school: "",
        p_health_conditions: built.form.medical.conditions,
        p_parent_name: parentName,
        p_parent_email: parentEmail,
        p_parent_phone: parentPhone || "—",
        p_coaching_interest: false,
        p_coaching_note: "",
        p_data_consent: true,
      });
      if (!error) return { outcome: { personId, destination: "waiting_list" } };
      // fall through to the team-less registration rather than losing them
    }
  }

  const fallback = {
    ...built.form,
    // Recorded so the admin queue can see why this row has no team.
    previous_club: built.form.previous_club,
  };
  const { error } = await supabase.from("registrations").insert({
    person_id: personId,
    season_id: season.id,
    team_id: null,
    form: JSON.parse(
      JSON.stringify({ ...fallback, no_team_note: "No suitable team at joining; waiting list group not open." }),
    ),
    form_version: REGISTRATION_FORM_VERSION,
  });
  if (error) return { error: tidyRpcMessage(error.message) };
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
