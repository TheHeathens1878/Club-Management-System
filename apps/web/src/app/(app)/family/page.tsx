import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Baby, ClipboardList, Contact, ShieldCheck, UserPlus } from "lucide-react";

import type { Json } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { ActionBar } from "@/components/ui/action-bar";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FoldCard } from "@/components/ui/fold-card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { signPeoplePhotos } from "@/lib/avatars";
import { loadEmergencyContacts } from "@/lib/emergency-contacts-server";
import {
  childReadiness,
  householdNextAction,
  type FamilyChild,
  type HouseholdActionKey,
} from "@/lib/family-readiness";
import { personLabel } from "@/lib/people-display";
import { getCurrentPersonId } from "@/lib/person";
import {
  loadLivePhotoConsents,
  loadRegistrationDetails,
} from "@/lib/registration-details-server";
import { questionFromRow, type RegistrationQuestion } from "@/lib/registration-questions";
import { createClient } from "@/lib/supabase/server";

import {
  childIdFrom,
  childSheetModeFrom,
  type ChildSheetPanelMode,
} from "./child-sheet-modes";
import { ChildSheet } from "./child-sheet";
import {
  HOUSEHOLD_ACTION_BUTTON,
  addressField,
  addressLine,
  ageGroupHint,
  familyHref,
  hasOwnAddress,
  parseTeams,
} from "./family-facts";
import { AddChildForm, type ChildDetails, type TeamOption } from "./family-forms";
import { FamilyGrid, type FamilyGridRow } from "./family-grid";
import {
  ChildSheetBody,
  RegistrationList,
  type ChildSheetData,
  type RegistrationRow,
} from "./sheet-bodies";

export const metadata = { title: "Children" };

/**
 * Children (gap 9, made over in P8.6) — the only screen a parent has.
 *
 * The question a parent comes here with is "is my child ready for the season?",
 * and the screen now answers it in that order:
 *
 *   1. ONE LINE at the top of what the household owes the club, from
 *      `householdNextAction()`, with the one button that does it.
 *   2. A READINESS GRID: a row per child, a column for each of the four
 *      things the club needs — details, somebody to ring, whether they may
 *      have a login, their registration — each cell saying its state in words
 *      and opening the panel at the mode that fixes it.
 *   3. FOLDED BENEATH: the parent's own registrations, and adding a child.
 *
 * Everything is read through the caller's own client, and every list is
 * therefore the database's answer rather than this page's:
 *
 *   · `my_children()` returns the caller's live guardianships with the child's
 *     name and current teams. It is SECURITY DEFINER because a guardian may
 *     not join `team_memberships` themselves — the function does the joins the
 *     caller is not allowed to make, and only for their own children.
 *   · `registrations` comes back under `registrations_guardian_read` and
 *     `registrations_self_read`. Nothing is filtered here to achieve that.
 *
 * The grid shows an age group hint, not the date of birth: a parent already
 * knows their child's birthday, and a screen that prints children's dates of
 * birth is a screen that leaks them over someone's shoulder.
 *
 * Editing is CONTACT ONLY (Adam, 2026-08-25), through
 * `update_child_details()`. `people` still has a guardian READ policy and no
 * guardian WRITE policy (P1.2 / SG-4) — the RPC is the whole authority — and
 * the name and the date of birth are not fields on the form because they are
 * not arguments to the function. The panel says so rather than offering a
 * button the database would refuse, and for the same reason it is a
 * `ChildSheet` rather than `PersonSheet`: a parent is offered only the modes
 * they hold a write for. `canAdmin` is not a prop that exists here.
 *
 * `?sheet=<mode>&child=<id>` is what opens the panel, which is what keeps the
 * reads lazy: the form builder's questions and the answers from the last
 * registration are fetched only for the mode that wants them.
 */

export const dynamic = "force-dynamic";

/** The icon for each thing the household can owe. */
const ACTION_ICON: Record<HouseholdActionKey, ReactNode> = {
  "add-child": <UserPlus className="h-4 w-4" aria-hidden />,
  "add-emergency-contact": <Contact className="h-4 w-4" aria-hidden />,
  "grant-app-access": <ShieldCheck className="h-4 w-4" aria-hidden />,
  "register-child": <ClipboardList className="h-4 w-4" aria-hidden />,
};

export default async function FamilyPage({
  searchParams,
}: {
  searchParams: Promise<{ sheet?: string | string[]; child?: string | string[] }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { sheet: rawSheet, child: rawChild } = await searchParams;
  const requestedMode = childSheetModeFrom(rawSheet);
  const requestedChild = childIdFrom(rawChild);

  const supabase = await createClient();
  const personId = await getCurrentPersonId();

  const [childrenResult, teamsResult, seasonsResult] = await Promise.all([
    supabase.rpc("my_children"),
    supabase
      .from("teams")
      .select("id,name,age_group,gender,sort_order")
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase.from("seasons").select("id,name,is_current").order("starts_on", { ascending: false }),
  ]);

  const children = childrenResult.data ?? [];
  const teams: TeamOption[] = (teamsResult.data ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    ageGroup: team.age_group,
    gender: team.gender,
  }));
  const seasons = seasonsResult.data ?? [];
  const currentSeason = seasons.find((season) => season.is_current) ?? null;
  const teamNames = new Map(teams.map((team) => [team.id, team.name] as const));
  const seasonNames = new Map(seasons.map((season) => [season.id, season.name] as const));

  // Which child the panel is about, and therefore which child anything read
  // per-mode below is read FOR. A `?child=` the caller is not a guardian of
  // does not open anything — the database would refuse it anyway, and a panel
  // that opens on somebody else's child is not a thing to offer at all.
  const openChild =
    requestedMode && requestedChild
      ? (children.find((child) => child.person_id === requestedChild) ?? null)
      : null;
  const mode: ChildSheetPanelMode | null = openChild ? requestedMode : null;

  // One read for every registration the caller may see — their children's
  // through `registrations_guardian_read`, their own through
  // `registrations_self_read`.
  const childIds = children.map((child) => child.person_id);
  const subjectIds = [...childIds, ...(personId ? [personId] : [])];
  let registrations: RegistrationRow[] = [];
  let registrationsError: string | null = null;
  if (subjectIds.length > 0) {
    const { data, error } = await supabase
      .from("registrations")
      .select("id,person_id,season_id,team_id,status,decision_note,submitted_at,decided_at")
      .in("person_id", subjectIds)
      .order("submitted_at", { ascending: false });
    registrations = data ?? [];
    registrationsError = error?.message ?? null;
  }

  const byPerson = new Map<string, RegistrationRow[]>();
  for (const registration of registrations) {
    const list = byPerson.get(registration.person_id);
    if (list) list.push(registration);
    else byPerson.set(registration.person_id, [registration]);
  }
  const myRegistrations = personId ? (byPerson.get(personId) ?? []) : [];

  // The photo the club holds for each child — `people_guardian_read` is what
  // lets a parent see the row at all, so an unentitled reader gets initials.
  const { data: childPhotoRows } =
    childIds.length > 0
      ? await supabase.from("people").select("id,photo_path").in("id", childIds)
      : { data: [] as { id: string; photo_path: string | null }[] };
  const childPhotoUrls = await signPeoplePhotos(childPhotoRows ?? []);

  // ------------------------------------------------------------------
  // SG-10 — the app-account consent, one live row per child at most.
  //
  // `guardian_consents_guardian_read` is what narrows this to the caller's own
  // children; the `.in(...)` is only so the query is one round trip for the
  // children already on screen. The age threshold is read from
  // `site_settings` rather than hard-coded, because it is admin-editable and
  // the database validates it (P1.7 §6).
  //
  // The contact half of each child's record comes with it, plus the caller's
  // OWN address — the thing "Same address as lead contact" copies. Both are
  // the caller's reads: the children under `people_guardian_read`, the caller
  // under `people_self_read`. Nothing here is filtered by hand.
  // ------------------------------------------------------------------
  const [consentsResult, minAgeResult, childContactResult, leadResult] = await Promise.all([
    childIds.length > 0
      ? supabase
          .from("guardian_consents")
          .select("id,child_person_id,granted_at")
          .in("child_person_id", childIds)
          .eq("consent_type", "app_account")
          .is("revoked_at", null)
      : Promise.resolve({
          data: [] as { id: string; child_person_id: string; granted_at: string }[],
          error: null,
        }),
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", "safeguarding.min_account_age")
      .maybeSingle(),
    childIds.length > 0
      ? supabase
          .from("people")
          .select("id,preferred_name,email,phone,address,dob")
          .in("id", childIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            preferred_name: string | null;
            email: string | null;
            phone: string | null;
            address: Json | null;
            dob: string | null;
          }[],
          error: null,
        }),
    personId
      ? supabase
          .from("people")
          .select("first_name,last_name,phone,address")
          .eq("id", personId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const leadAddress = leadResult.data?.address ?? null;
  const leadAddressLine = addressLine(leadAddress);
  // The caller as "I am the first emergency contact" — name and number from
  // their own record, which is what the server copies when the box is ticked.
  const lead = leadResult.data
    ? {
        name: `${leadResult.data.first_name} ${leadResult.data.last_name}`.trim(),
        phone: leadResult.data.phone,
      }
    : null;

  const consentByChild = new Map(
    (consentsResult.data ?? []).map(
      (row) => [row.child_person_id, { id: row.id, grantedAt: row.granted_at }] as const,
    ),
  );
  const minAccountAge = Number(minAgeResult.data?.value ?? "13") || 13;

  // Emergency contacts (Adam, 2026-08-25: on the person, not the form), read
  // under `emergency_contacts_self_read`.
  const contactsByChild = await loadEmergencyContacts(childIds);

  /** Whether the club holds an address of the child's own — the Details cell. */
  const hasAddressByChild = new Map<string, boolean>();
  const detailsByChild = new Map(
    (childContactResult.data ?? []).map((row) => {
      const line1 = addressField(row.address, "line1");
      const town = addressField(row.address, "town");
      const county = addressField(row.address, "county");
      const postcode = addressField(row.address, "postcode");
      const line2 = addressField(row.address, "line2");
      const hasOwn = hasOwnAddress(row.address);
      hasAddressByChild.set(row.id, hasOwn);
      const details: ChildDetails = {
        preferredName: row.preferred_name ?? "",
        email: row.email ?? "",
        phone: row.phone ?? "",
        line1,
        line2,
        town,
        county,
        postcode,
        // Ticked when the child's address IS the lead contact's, and for a
        // child with no address of their own — the common case, and the one
        // the tick-box exists to make one click long.
        sameAsLead: !!leadAddressLine && (!hasOwn || addressLine(row.address) === leadAddressLine),
      };
      return [row.id, details] as const;
    }),
  );

  // ------------------------------------------------------------------
  // Per-mode reads. Everything below happens only for the panel that is
  // actually open, and only for the child it is open on.
  // ------------------------------------------------------------------
  const wantsQuestions = mode === "register" || mode === "snapshot";
  const { data: questionRows } = wantsQuestions
    ? await supabase
        .from("registration_questions")
        .select("id,qkey,label,help_text,qtype,options,required,system,locked,position,archived_at")
        .is("archived_at", null)
        .order("position")
    : { data: null };
  const questions: RegistrationQuestion[] = (questionRows ?? [])
    .map((row) => questionFromRow(row))
    .filter((question): question is RegistrationQuestion => question !== null);
  const questionLabels = new Map(
    questions.map((question) => [question.qkey, question.label] as const),
  );

  // The registration form as the club currently asks it: whether the child
  // still owes an ID (`needs_id_document()`, the way /join asks it) and the
  // sex the club already holds, so the form defaults to it rather than asking
  // again. Whether the caller is a club administrator is the only role
  // offered "show all teams" (Adam, 2026-08-26).
  let registerFacts: { needsId: boolean; recordedSex: string | null } | null = null;
  if (mode === "register" && openChild) {
    const [needsIdResult, subjectsResult] = await Promise.all([
      supabase.rpc("needs_id_document", { p_person_id: openChild.person_id }),
      supabase.rpc("registration_subjects", { p_person_ids: [openChild.person_id] }),
    ]);
    registerFacts = {
      needsId: needsIdResult.data === true,
      recordedSex: subjectsResult.data?.[0]?.sex ?? null,
    };
  }

  // What the club holds from the last registration, and the live SG-5 photo
  // permissions beside it (Adam, 2026-08-25: "the registration form should
  // update read-only information in the contact record"). Both are the
  // caller's own reads — `person_registration_details` carries the
  // `registrations` read policies, so a parent sees their own children's and
  // nothing else, and nothing here is filtered by hand.
  let snapshot: ChildSheetData["snapshot"] = null;
  let photoConsents = new Set<string>();
  if (mode === "snapshot" && openChild) {
    const [detailsByPerson, photoConsentsByChild] = await Promise.all([
      loadRegistrationDetails([openChild.person_id]),
      loadLivePhotoConsents([openChild.person_id]),
    ]);
    snapshot = detailsByPerson.get(openChild.person_id) ?? null;
    photoConsents = photoConsentsByChild.get(openChild.person_id) ?? new Set();
  }

  // ------------------------------------------------------------------
  // What the screen says
  // ------------------------------------------------------------------
  const familyChildren: FamilyChild[] = children.map((child) => ({
    personId: child.person_id,
    firstName: child.preferred_name || child.first_name,
    isMinor: child.is_minor,
    dob: child.dob,
    hasAddress: hasAddressByChild.get(child.person_id) ?? false,
    contactsCount: (contactsByChild.get(child.person_id) ?? []).length,
    appAccessGrantedAt: consentByChild.get(child.person_id)?.grantedAt ?? null,
    minAccountAge,
    registrations: (byPerson.get(child.person_id) ?? []).map((registration) => ({
      status: registration.status,
      teamName: registration.team_id ? (teamNames.get(registration.team_id) ?? null) : null,
      seasonName: seasonNames.get(registration.season_id) ?? null,
      submittedAt: registration.submitted_at,
    })),
  }));
  const readinessOptions = { seasonName: currentSeason?.name ?? null };
  const next = householdNextAction(familyChildren, readinessOptions);

  const rows: FamilyGridRow[] = children.map((child, index) => {
    const familyChild = familyChildren[index]!;
    const readiness = childReadiness(familyChild, readinessOptions);
    // The Registration cell's door is whichever one is useful: the form when
    // there is nothing live, the list (and its withdraw) when there is.
    const registrationMode: ChildSheetPanelMode =
      readiness.registration.state === "missing" && currentSeason ? "register" : "registrations";
    return {
      personId: familyChild.personId,
      name: personLabel({
        first_name: child.first_name,
        last_name: child.last_name,
        preferred_name: child.preferred_name,
      }),
      photoUrl: childPhotoUrls.get(familyChild.personId),
      ageGroup: ageGroupHint(child.dob),
      isMinor: familyChild.isMinor,
      relationship: child.relationship,
      teams: parseTeams(child.teams).map((team) => ({
        id: team.team_id,
        label: `${team.team_name} · ${team.role.replace(/_/g, " ")}`,
      })),
      readiness,
      hrefs: {
        details: familyHref("details", familyChild.personId),
        contacts: familyHref("contacts", familyChild.personId),
        access: familyHref("access", familyChild.personId),
        registration: familyHref(registrationMode, familyChild.personId),
      },
      chipHref: familyHref(null, familyChild.personId),
    };
  });

  // The status bar's one button. "Add a child" is not a panel — it is the
  // fold at the bottom, which opens on its own when the household is empty.
  const actionHref =
    next.mode === "add"
      ? "#add-a-child"
      : familyHref(next.mode as ChildSheetPanelMode, next.personId ?? null);

  const sheetData: ChildSheetData | null = openChild
    ? {
        personId: openChild.person_id,
        name: personLabel({
          first_name: openChild.first_name,
          last_name: openChild.last_name,
          preferred_name: openChild.preferred_name,
        }),
        firstName: openChild.preferred_name || openChild.first_name,
        isMinor: openChild.is_minor,
        dob: openChild.dob,
        details: detailsByChild.get(openChild.person_id) ?? {
          preferredName: openChild.preferred_name ?? "",
          email: "",
          phone: "",
          line1: "",
          line2: "",
          town: "",
          county: "",
          postcode: "",
          sameAsLead: !!leadAddressLine,
        },
        leadAddressLine,
        contacts: contactsByChild.get(openChild.person_id) ?? [],
        lead,
        consent: consentByChild.get(openChild.person_id) ?? null,
        minAccountAge,
        registrations: byPerson.get(openChild.person_id) ?? [],
        teamNames,
        seasonNames,
        register:
          currentSeason && registerFacts
            ? {
                seasonId: currentSeason.id,
                seasonName: currentSeason.name,
                teams,
                questions,
                needsId: registerFacts.needsId,
                recordedSex: registerFacts.recordedSex,
                isAdmin: isCommittee(session.profile?.role),
              }
            : null,
        snapshot,
        photoConsents,
        questionLabels,
      }
    : null;

  // Four separate red boxes used to stack above the screen, one per read. They
  // are one line now: what did not load, and the club's own words for why.
  const failures = [
    childrenResult.error?.message ? `your children (${childrenResult.error.message})` : null,
    registrationsError ? `registrations (${registrationsError})` : null,
    childContactResult.error?.message
      ? `contact details (${childContactResult.error.message})`
      : null,
    consentsResult.error?.message ? `app access (${consentsResult.error.message})` : null,
  ].filter((line): line is string => line !== null);

  const ownSummary =
    myRegistrations.length === 1
      ? "1 registration in your own name"
      : `${myRegistrations.length} registrations in your own name`;

  return (
    <>
      <PageHeader
        title="Children"
        subtitle="The children the club has you down as a guardian for, and their registrations"
      />

      <div className="space-y-4 p-4 lg:p-6">
        {failures.length > 0 && (
          <Callout tone="danger" title="Some of this screen did not load">
            The club could not read {failures.join("; ")}. What is missing is missing — nothing
            below has been guessed at.
          </Callout>
        )}

        <ActionBar
          icon={ACTION_ICON[next.key]}
          status={next.label}
          detail={next.why}
          tone={next.tone}
          action={
            <Link href={actionHref} className={buttonVariants({ size: "touch" })}>
              {HOUSEHOLD_ACTION_BUTTON[next.key]}
            </Link>
          }
        />

        <FamilyGrid rows={rows} focusedId={requestedChild} />

        <div className="space-y-2 pt-2">
          {myRegistrations.length > 0 && (
            <FoldCard
              icon={<ClipboardList className="h-4 w-4" aria-hidden />}
              title="Your own registrations"
              summary={ownSummary}
            >
              <RegistrationList
                registrations={myRegistrations}
                teamNames={teamNames}
                seasonNames={seasonNames}
                canWithdraw
              />
            </FoldCard>
          )}

          {/* The empty household's one press, and the ordinary door the rest of
              the time. It opens itself when there is nobody here, because then
              it is the only thing on the screen worth doing. */}
          <div id="add-a-child" className="scroll-mt-4">
            <FoldCard
              icon={<Baby className="h-4 w-4" aria-hidden />}
              title="Add a child"
              summary="Creates their record and records you as their guardian in one step"
              defaultOpen={children.length === 0}
            >
              <AddChildForm />
            </FoldCard>
          </div>
        </div>
      </div>

      {sheetData && (
        <ChildSheet
          childName={sheetData.name}
          mode={mode}
          closeHref={familyHref(null, sheetData.personId)}
          modeHrefs={{
            details: familyHref("details", sheetData.personId),
            contacts: familyHref("contacts", sheetData.personId),
            access: familyHref("access", sheetData.personId),
            register: familyHref("register", sheetData.personId),
            registrations: familyHref("registrations", sheetData.personId),
            snapshot: familyHref("snapshot", sheetData.personId),
          }}
          canEdit
          canRegister={!!currentSeason}
        >
          {mode ? <ChildSheetBody mode={mode} data={sheetData} /> : null}
        </ChildSheet>
      )}
    </>
  );
}
