/**
 * Is this child ready for the season? (P8.6)
 *
 * `/family` is the only screen a parent has, and today it answers that
 * question by making them read four long cards per child and work it out.
 * `childReadiness()` turns each card into one cell that says its state in
 * words — "On file", "None yet", "Waiting on you" — so a household of three
 * children is a grid a parent can read in a glance.
 *
 * WHAT IT DOES NOT DO. Nothing here decides who may see or change anything:
 * `my_children()` and `update_child_details()` are the whole authority and the
 * page passes in what they already returned. Nor does it print a date of
 * birth — the screen shows an age group, deliberately, because a list of
 * children's birthdays is a thing somebody can read over your shoulder.
 *
 * Pure: no Supabase client, no server-only import. Importable from a server
 * page and a `"use client"` component alike.
 */

/** Both the cells and the bar use the same five words for the same five states. */
export type ReadinessState = "ok" | "missing" | "waiting" | "pending";

export type ReadinessCell = {
  state: ReadinessState;
  text: string;
};

export type ChildReadiness = {
  details: ReadinessCell;
  contacts: ReadinessCell;
  access: ReadinessCell;
  registration: ReadinessCell;
};

/** The `ChildSheet` mode a cell or a bar button opens (P8.6's mode list). */
export type ChildSheetMode =
  | "details"
  | "contacts"
  | "access"
  | "register"
  | "registrations"
  | "snapshot"
  | "add";

/** A registration as `/family` already reads it, plus the names it displays. */
export type ChildRegistration = {
  status: string;
  /** The team the registration names, once it has one. */
  teamName: string | null;
  seasonName: string | null;
  submittedAt: string | null;
};

/**
 * One child, shaped as `/family` already holds them: the `my_children()` row
 * plus the four small reads the page makes beside it.
 */
export type FamilyChild = {
  personId: string;
  /** What the parent calls them — `preferred_name || first_name`. */
  firstName: string;
  isMinor: boolean;
  dob: string | null;
  /**
   * Whether the club holds an address for them — their own, or the lead
   * contact's copied onto them. The page already works this out for the
   * "same as mine" tick-box.
   */
  hasAddress: boolean;
  /** `emergency_contacts` rows on the child. */
  contactsCount: number;
  /** The live SG-10 app-account consent, or null. */
  appAccessGrantedAt: string | null;
  /** `safeguarding.min_account_age` from `site_settings` — never hard-coded. */
  minAccountAge: number;
  registrations: readonly ChildRegistration[];
};

export type HouseholdActionKey =
  | "add-child"
  | "add-emergency-contact"
  | "grant-app-access"
  | "register-child";

export type HouseholdNextAction = {
  key: HouseholdActionKey;
  label: string;
  why: string;
  tone: "idle" | "waiting" | "done" | "error" | "pending";
  mode: ChildSheetMode;
  /** Which child the line is about, where it is about one. */
  personId?: string;
};

export type HouseholdOptions = {
  /** The current season's name, for "Register Amelia for 2026/27". */
  seasonName?: string | null;
  /** The instant "now" is, handed in so the answer is testable. */
  now?: Date;
};

/**
 * "12 Aug" — a day the way a readiness cell says it.
 *
 * The consent stamp is a timestamptz, so the club's own zone decides which
 * day it was; the app's `formatStamp` adds the year and the time, which is
 * more than a cell has room for.
 */
function dayLabel(stamp: string | null | undefined): string | null {
  if (!stamp) return null;
  const at = new Date(stamp);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
  });
}

/**
 * The day a child may first have a login of their own.
 *
 * SG-10's guard on `profiles` is what actually refuses an account below
 * `min_account_age`; this mirrors `AppAccessForm`'s arithmetic so the cell
 * does not promise access the database would refuse.
 */
function eligibleFrom(dob: string | null, minAccountAge: number): Date | null {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  const at = new Date(birth);
  at.setUTCFullYear(at.getUTCFullYear() + minAccountAge);
  return at;
}

/** The registration that speaks for the child — the most recently submitted. */
function latestRegistration(child: FamilyChild): ChildRegistration | null {
  let latest: ChildRegistration | null = null;
  for (const registration of child.registrations) {
    if (!latest) {
      latest = registration;
      continue;
    }
    const a = registration.submittedAt ?? "";
    const b = latest.submittedAt ?? "";
    if (a > b) latest = registration;
  }
  return latest;
}

/** The four cells of one child's row in the readiness grid. */
export function childReadiness(child: FamilyChild, options: HouseholdOptions = {}): ChildReadiness {
  const now = options.now ?? new Date();

  const details: ReadinessCell = child.hasAddress
    ? { state: "ok", text: "On file" }
    : { state: "missing", text: "None yet" };

  const contacts: ReadinessCell =
    child.contactsCount > 0
      ? { state: "ok", text: `${child.contactsCount} on file` }
      : { state: "missing", text: "None yet" };

  const grantedOn = dayLabel(child.appAccessGrantedAt);
  const startsOn = eligibleFrom(child.dob, child.minAccountAge);
  const access: ReadinessCell = grantedOn
    ? { state: "ok", text: `Allowed ${grantedOn}` }
    : startsOn && startsOn.getTime() > now.getTime()
      ? { state: "pending", text: `From age ${child.minAccountAge}` }
      : { state: "waiting", text: "Waiting on you" };

  const registration = latestRegistration(child);
  const registrationCell: ReadinessCell = ((): ReadinessCell => {
    if (!registration) return { state: "missing", text: "Not registered" };
    if (registration.status === "approved") {
      return {
        state: "ok",
        text: registration.teamName ? `Approved — ${registration.teamName}` : "Approved",
      };
    }
    if (registration.status === "pending") return { state: "pending", text: "Pending" };
    if (registration.status === "withdrawn") return { state: "missing", text: "Withdrawn" };
    if (registration.status === "rejected") return { state: "missing", text: "Not approved" };
    return { state: "missing", text: "Not registered" };
  })();

  return { details, contacts, access, registration: registrationCell };
}

/** True when the child has nothing live to play under this season. */
function needsRegistering(child: FamilyChild, options: HouseholdOptions): boolean {
  const cell = childReadiness(child, options).registration;
  return cell.state === "missing";
}

/**
 * The one line at the top of `/family`.
 *
 * A child with nobody to ring outranks a child who is not registered
 * deliberately: the club can sort a registration out next week, and it cannot
 * sort out not knowing who to call on the night.
 */
export function householdNextAction(
  children: readonly FamilyChild[],
  options: HouseholdOptions = {},
): HouseholdNextAction {
  // 1. An empty household — the screen's whole purpose, and its one press.
  if (children.length === 0) {
    return {
      key: "add-child",
      tone: "pending",
      label: "Add a child",
      why: "The club has no children recorded against your account yet. Adding one creates their record and records you as their guardian in one step.",
      mode: "add",
    };
  }

  // 2. A child with no emergency contact.
  const noContact = children.find((child) => child.isMinor && child.contactsCount === 0);
  if (noContact) {
    return {
      key: "add-emergency-contact",
      tone: "error",
      label: `${noContact.firstName} has no emergency contact`,
      why: `The club holds nobody to ring for ${noContact.firstName}. Add a contact before their next session.`,
      mode: "contacts",
      personId: noContact.personId,
    };
  }

  // 3. A child not registered for the season.
  const unregistered = children.find((child) => needsRegistering(child, options));
  if (unregistered) {
    const season = options.seasonName;
    return {
      key: "register-child",
      tone: "pending",
      label: season
        ? `Register ${unregistered.firstName} for ${season}`
        : `Register ${unregistered.firstName}`,
      why: `${unregistered.firstName} has no live registration${season ? ` for ${season}` : ""}, so they are not yet in a squad for it.`,
      mode: "register",
      personId: unregistered.personId,
    };
  }

  // 4. App access the club is waiting on the parent to allow.
  const accessWaiting = children.find(
    (child) => childReadiness(child, options).access.state === "waiting",
  );
  if (accessWaiting) {
    return {
      key: "grant-app-access",
      tone: "waiting",
      label: `${accessWaiting.firstName}'s app access is waiting on you`,
      why: `${accessWaiting.firstName} is old enough for a login of their own, and cannot have one until you allow it.`,
      mode: "access",
      personId: accessWaiting.personId,
    };
  }

  // 5. Nothing outstanding. The bar goes quiet and offers the ordinary door.
  return {
    key: "add-child",
    tone: "done",
    label: "Add a child",
    why:
      children.length === 1
        ? "Everything the club needs for your child is on file."
        : "Everything the club needs for your children is on file.",
    mode: "add",
  };
}
