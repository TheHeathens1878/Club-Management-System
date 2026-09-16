import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  Clock,
  FileText,
  History,
  IdCard,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";

import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ActionBar } from "@/components/ui/action-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FoldCard } from "@/components/ui/fold-card";
import { PersonFacts, type PersonFactKey } from "@/components/person/person-facts";
import { PersonSheet } from "@/components/person/person-sheet";
import {
  PERSON_SHEET_MODES,
  PERSON_TAB_REDIRECTS,
  personSheetModeFrom,
} from "@/components/person/person-sheet-modes";
import { PersonTeams, type PersonTeamRow } from "@/components/person/person-teams";
import { getSessionProfile, isCommittee, isSuperUser } from "@/lib/auth";
import { signPeoplePhotos, signPersonPhotoPath } from "@/lib/avatars";
import { signIdentityDocumentPaths } from "@/lib/identity-docs";
import {
  currentMembership,
  membershipKindWord,
  type PersonMembershipRow,
} from "@/lib/membership-kind";
import { isClubAdmin, resolveNames, nameOf } from "@/lib/person";
import { resolveUserNames } from "@/lib/registration-verifiers";
import {
  personNextAction,
  type PersonActionKey,
  type PersonSheetMode,
} from "@/lib/person-record-state";
import {
  RegistrationDetailsBody,
  registrationDetailsCaption,
} from "@/components/registration-details";
import {
  loadLivePhotoConsents,
  loadRegistrationDetails,
} from "@/lib/registration-details-server";
import { formatDate, formatStamp, isMinorDob, personLabel } from "@/lib/people-display";
import { idDocumentKindLabel } from "@/lib/registration-questions";
import { ageGroupFromDobString } from "@/lib/waiting-list";
import { createClient } from "@/lib/supabase/server";
import { parseFamilyTree, familyTreePersonIds } from "@/lib/family-tree";

import { loadEmergencyContacts } from "@/lib/emergency-contacts-server";

import type { GuardianshipRow, RoleRow } from "@/components/person/person-panels";

import {
  IdentityDocumentList,
  PersonSheetBody,
  type PersonSheetData,
} from "./sheet-bodies";

/**
 * One person's record (gap 2), as one object with a status line and a panel.
 *
 *   1. THE STATUS BAR — the ONE thing this record needs next, from
 *      `personNextAction()`: imports the migration cannot apply, a missing
 *      date of birth, a child with nobody to ring, an adult in a child-facing
 *      role whose ID nobody has recorded seeing — or, when there is nothing
 *      outstanding, "Record complete" and the ordinary door into the details.
 *   2. THE FACTS BAND — the eight things an administrator opened the record to
 *      find out, each one press from the place it is changed.
 *   3. THE TEAMS, then the RECORD, the latest REGISTRATION and the PROOF OF
 *      IDENTITY folded beneath, each fold's closed line real text computed
 *      here so the row is worth reading shut.
 *   4. EVERYTHING YOU CHANGE opens in `PersonSheet` over the top, addressed by
 *      `?sheet=<mode>`. That is what keeps the expensive reads lazy: the
 *      family tree, the subscriptions and the payments are fetched only when
 *      the mode that wants them is the mode being asked for.
 *
 * Everything is read through the caller's own client. Where a policy says no —
 * `registrations.form` is club_admin, safeguarding_lead, the subject or their
 * guardian, and nobody else — the read simply returns nothing and the section
 * is not rendered. That is the intended behaviour: the page shows what the
 * caller is entitled to see, and works out nothing for itself. The facts band
 * inherits the rule: an absent membership number is a reader who was not shown
 * the billing row, not a person without one.
 *
 * THE MEMBERSHIP MODE (Adam, 2026-08-26) is the same rule: it reads
 * `person_memberships`, a security_invoker view over `memberships` and
 * `membership_people`, so it renders only for a reader those policies already
 * admit (the lead contact, club_admin, safeguarding_lead). Individual or
 * Family is the DATABASE's answer, derived from the number of PLAYERS on the
 * membership in that season, and it lists the other people on it so an
 * administrator can click straight through to the rest of the family.
 */

// The person's own name would be the obvious tab title and is exactly what
// must not go there: a browser tab, a screen share and a history entry are all
// places a member's name would travel further than the page itself.
export const metadata = { title: "Member record" };

/** The modes only a club administrator is offered. */
const ADMIN_MODES: readonly PersonSheetMode[] = ["roles", "guardianships", "danger"];

/**
 * `/people` hands its own query string over in `from`, so Back returns to the
 * page, chip and filters the reader left rather than to an unfiltered page 1.
 * Only a relative query string is honoured — anything else falls back to the
 * bare list, so the parameter cannot be used to bounce somebody off-site.
 */
function backHref(from: string | undefined): string {
  if (!from) return "/people";
  const query = new URLSearchParams(from);
  const text = query.toString();
  return text ? `/people?${text}` : "/people";
}

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; tab?: string | string[]; sheet?: string | string[] }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/lobby");

  const { id } = await params;
  const { from, tab: rawTab, sheet: rawSheet } = await searchParams;

  /**
   * The record used to be two tabs. `?tab=membership` is in emails, in the
   * billing links on this very page and in everybody's history, so it is
   * answered rather than ignored: it becomes the membership panel.
   */
  if (rawTab !== undefined) {
    const key = Array.isArray(rawTab) ? rawTab[0] : rawTab;
    const asMode = PERSON_TAB_REDIRECTS[key ?? ""] ?? null;
    const moved = new URLSearchParams();
    if (asMode) moved.set("sheet", asMode);
    if (from) moved.set("from", from);
    const text = moved.toString();
    redirect(`/people/${id}${text ? `?${text}` : ""}`);
  }

  const sheet = personSheetModeFrom(rawSheet);
  const supabase = await createClient();

  const { data: person } = await supabase.from("people").select("*").eq("id", id).maybeSingle();
  if (!person) notFound();

  const [
    { data: roleRows },
    { data: guardianshipRows },
    { data: membershipRows },
    { data: registration },
    { data: pendingRows },
    { data: profileRow },
    { data: childFacingRows },
  ] = await Promise.all([
    supabase
      .from("person_roles")
      .select("id,role,granted_at,notes")
      .eq("person_id", id)
      .is("revoked_at", null)
      .order("granted_at"),
    supabase
      .from("guardianships")
      .select("id,guardian_person_id,child_person_id,relationship,ended_at")
      .or(`guardian_person_id.eq.${id},child_person_id.eq.${id}`)
      .order("created_at"),
    supabase
      .from("team_memberships")
      .select("id,team_id,role,shirt_number,joined_at,left_at,teams(name),seasons(name,is_current)")
      .eq("person_id", id)
      .order("joined_at", { ascending: false }),
    supabase
      .from("registrations")
      .select("id,status,submitted_at,seasons(name)")
      .eq("person_id", id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("neon_import_pending")
      .select("id,kind,payload,created_at,attempts,last_error,applied_at")
      .eq("person_id", id)
      .is("applied_at", null)
      .order("created_at"),
    supabase.from("profiles").select("id,full_name,role").eq("person_id", id).maybeSingle(),
    // SG-6 keeps "which role works with children" in a lookup rather than in a
    // trigger's hard-coded list, so the status bar asks the lookup rather than
    // deciding for itself. Four rows, readable by anyone signed in.
    supabase.from("child_facing_roles").select("role,child_facing").eq("child_facing", true),
  ]);

  const roles: RoleRow[] = (roleRows ?? []).map((row) => ({
    id: row.id,
    role: row.role,
    grantedAt: row.granted_at,
    notes: row.notes,
  }));

  // Names for the other end of each guardianship, through the helper that asks
  // `display_name()` for anyone the bulk `people` read would not return.
  const otherIds = (guardianshipRows ?? []).map((row) =>
    row.guardian_person_id === id ? row.child_person_id : row.guardian_person_id,
  );
  const names = await resolveNames(otherIds);
  const guardianships: GuardianshipRow[] = (guardianshipRows ?? []).map((row) => {
    const personIsGuardian = row.guardian_person_id === id;
    const otherPersonId = personIsGuardian ? row.child_person_id : row.guardian_person_id;
    return {
      id: row.id,
      otherPersonId,
      otherName: nameOf(names, otherPersonId),
      relationship: row.relationship,
      personIsGuardian,
      endedAt: row.ended_at,
    };
  });

  const pending = pendingRows ?? [];
  const name = personLabel(person);

  const teamRows: PersonTeamRow[] = (membershipRows ?? []).map((row) => ({
    id: row.id,
    teamId: row.team_id,
    teamName: row.teams?.name ?? "Team",
    seasonName: row.seasons?.name ?? "Season unknown",
    seasonIsCurrent: !!row.seasons?.is_current,
    role: row.role,
    shirtNumber: row.shirt_number,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
  }));

  // The child-facing roles this person holds RIGHT NOW, as the lookup
  // designates them. A reader who is not shown `team_memberships` gets an
  // empty list and is never asked for an ID they cannot judge.
  const childFacing = new Set((childFacingRows ?? []).map((row) => row.role as string));
  const childFacingRoles = Array.from(
    new Set(teamRows.filter((row) => !row.leftAt && childFacing.has(row.role)).map((row) => row.role)),
  );

  // The club membership this person is tagged with, and the rest of the family
  // on it. Two small reads of `person_memberships`; both carry the view's
  // security_invoker RLS, so a reader who may not see the membership sees
  // nothing at all rather than a panel with the names missing.
  const { data: membershipTagRows } = await supabase
    .from("person_memberships")
    .select(
      "membership_id,kind,season_id,season_name,season_is_current,primary_person_id,is_primary,created_at",
    )
    .eq("person_id", id);
  const clubMembership = currentMembership((membershipTagRows ?? []) as PersonMembershipRow[]);
  const { data: familyRows } = clubMembership?.membership_id
    ? await supabase
        .from("person_memberships")
        .select("person_id,is_primary")
        .eq("membership_id", clubMembership.membership_id)
    : { data: [] as { person_id: string | null; is_primary: boolean | null }[] };
  const familyOthers = (familyRows ?? []).filter(
    (row): row is { person_id: string; is_primary: boolean | null } =>
      !!row.person_id && row.person_id !== id,
  );
  const familyNames = await resolveNames(familyOthers.map((row) => row.person_id));

  // The membership NUMBER (billing account, 20260904170000): the household
  // this person is billed under. Read under the caller's RLS — club_admin
  // holds the finance gate; a reader without it simply sees no number.
  const { data: billingRow } = await supabase
    .from("billing_account_people")
    .select("account_id,letter,billing_accounts(member_no,lead_person_id,status)")
    .eq("person_id", id)
    .is("removed_at", null)
    .maybeSingle();
  const { data: billingHousehold } = billingRow
    ? await supabase
        .from("billing_account_people")
        .select("person_id,letter,people(first_name,last_name)")
        .eq("account_id", billingRow.account_id)
        .is("removed_at", null)
        .order("letter")
    : { data: [] as never[] };

  // The expensive parts of the record, loaded only for the panel that asks for
  // them — a record opened to read a phone number should not pay for a family
  // tree and two money reads. This was the `?tab=membership` gate; it is finer
  // now, because the family tree and the money are two different modes.
  //
  // `family_tree_for()` (20260827130000) is the person-shaped twin of
  // `my_family_tree()`: asking the caller-scoped one here would draw the
  // ADMINISTRATOR'S own family under somebody else's name. It refuses anyone
  // who is not club_admin or safeguarding_lead, which is the readership this
  // page already requires.
  const membershipMode = sheet === "membership";
  const moneyMode = sheet === "money";

  const { data: treeData, error: treeError } = membershipMode
    ? await supabase.rpc("family_tree_for", { p_person_id: id })
    : { data: null, error: null };
  const familyTree = parseFamilyTree(treeData ?? null);

  const treePhotoIds = membershipMode ? familyTreePersonIds(familyTree) : [];
  const { data: treePhotoRows } =
    treePhotoIds.length > 0
      ? await supabase.from("people").select("id,photo_path").in("id", treePhotoIds)
      : { data: [] as { id: string; photo_path: string | null }[] };
  const treePhotoUrls = await signPeoplePhotos(treePhotoRows ?? []);

  // Subscriptions this person is the SUBJECT of, and the ones they PAY for —
  // a parent's record should show the bills they carry for their children.
  const { data: subscriptionRows } = moneyMode
    ? await supabase
        .from("subscriptions")
        .select(
          "id,person_id,payer_person_id,status,amount_due_pence,started_at,ended_at,subscription_plans(name,billing,amount_pence)",
        )
        .or(`person_id.eq.${id},payer_person_id.eq.${id}`)
        .order("started_at", { ascending: false })
    : { data: [] as never[] };
  const subscriptions = subscriptionRows ?? [];

  const { data: paymentRows } =
    moneyMode && subscriptions.length > 0
      ? await supabase
          .from("payments")
          .select("id,subscription_id,amount_pence,paid_at,method,kind,refunded_pence")
          .in(
            "subscription_id",
            subscriptions.map((row) => row.id),
          )
          .order("paid_at", { ascending: false })
      : { data: [] as never[] };
  const payments = paymentRows ?? [];

  const subjectNames = await resolveNames([
    ...subscriptions.map((row) => row.person_id),
    ...subscriptions.map((row) => row.payer_person_id),
  ].filter((value): value is string => !!value));

  // What the latest registration said about this person — the read-only copy
  // on the contact record (20260825260000). It carries the `registrations`
  // read policies, so a reader who is not entitled to the form gets nothing
  // back and the fold is not rendered. The SG-5 photo consents beside it are
  // `guardian_consents` rows, read the same way.
  const [snapshots, photoConsents, { data: questionRows }, verifierNames] = await Promise.all([
    loadRegistrationDetails([id]),
    isMinorDob(person.dob) ? loadLivePhotoConsents([id]) : Promise.resolve(new Map()),
    supabase.from("registration_questions").select("qkey,label").order("position"),
    resolveUserNames([person.id_verified_by]),
  ]);
  const snapshot = snapshots.get(id) ?? null;
  const questionLabels = new Map((questionRows ?? []).map((row) => [row.qkey, row.label] as const));

  // The registration photo, and any identity document the club holds. The
  // document ROWS come back to anyone the policy admits; the FILES are signed
  // only for a club administrator, which is the storage policy mirrored.
  const admin = await isClubAdmin();
  // Emergency contacts (Adam, 2026-08-25): on the person, read under
  // `emergency_contacts_admin_read` — club_admin and safeguarding_lead.
  const emergencyContacts = (await loadEmergencyContacts([id])).get(id) ?? [];
  const photoUrl = await signPersonPhotoPath(person.photo_path);
  const { data: documentRows } = await supabase
    .from("identity_documents")
    .select("id,kind,storage_path,created_at,purge_after,purged_at")
    .eq("person_id", id)
    .is("purged_at", null)
    .order("created_at", { ascending: false });
  const documents = documentRows ?? [];
  const documentUrls = admin
    ? await signIdentityDocumentPaths(documents.map((row) => row.storage_path))
    : new Map<string, string>();

  // -------------------------------------------------------------------------
  // What this record needs next, and where every press goes
  // -------------------------------------------------------------------------

  const next = personNextAction({
    person: { dob: person.dob, id_verified: person.id_verified, updated_at: person.updated_at },
    pendingImports: pending.length,
    emergencyContacts: emergencyContacts.length,
    childFacingRoles,
    identityDocuments: documents.length,
  });

  /**
   * Every press on this page is a URL. `from` rides along so Back still
   * returns to the list the reader came from, and a panel typed into the
   * address bar opens the same way a pressed tile does.
   */
  function personHref(mode: PersonSheetMode | null): string {
    const query = new URLSearchParams();
    if (mode) query.set("sheet", mode);
    if (from) query.set("from", from);
    const text = query.toString();
    return `/people/${id}${text ? `?${text}` : ""}`;
  }

  const modeHrefs = Object.fromEntries(
    PERSON_SHEET_MODES.map((mode) => [mode, personHref(mode)]),
  ) as Record<PersonSheetMode, string>;
  const closeHref = personHref(null);

  // `/people/[id]` is committee-only, so everyone who is here may edit; only a
  // club administrator is offered roles, guardianships and retiring. The SHEET
  // is told the answer, it never works it out — `/teams/[id]`'s squad and
  // `/family` reuse it with different answers.
  const canEdit = true;
  const canAdmin = admin;
  const superUser = isSuperUser(session.profile?.role);
  const mode = sheet && ADMIN_MODES.includes(sheet) && !canAdmin ? null : sheet;

  /** Where a fact tile goes. Teams are on the page itself, so they anchor. */
  const FACT_MODE: Record<PersonFactKey, PersonSheetMode | null> = {
    age: "details",
    login: "details",
    membership: "membership",
    memberNo: "membership",
    roles: "roles",
    guardianships: "guardianships",
    teams: null,
    identity: "identity",
  };

  const memberNo = billingRow?.billing_accounts
    ? `${String(billingRow.billing_accounts.member_no).padStart(5, "0")}${billingRow.letter}`
    : null;
  const liveTeams = teamRows.filter((row) => !row.leftAt).length;

  const idSummary =
    documents.length > 0
      ? documents
          .map(
            (document) =>
              `${idDocumentKindLabel(document.kind)} uploaded ${formatStamp(document.created_at)} · destroyed ${document.purge_after}`,
          )
          .join(" · ")
      : person.id_verified
        ? `ID seen${person.id_verified_at ? ` ${formatStamp(person.id_verified_at)}` : ""} · no document held`
        : "Nothing on file · nobody has recorded seeing an ID";

  const recordSummary = `Created ${formatStamp(person.created_at)} · last changed ${formatStamp(person.updated_at)}${
    person.dob ? ` · born ${formatDate(person.dob)}` : " · no date of birth"
  }${person.deleted_at ? " · retired" : ""}`;

  const registrationSummary = snapshot
    ? `${registrationDetailsCaption(snapshot.seasonName, snapshot.updatedAt)}${registration?.status ? ` · ${registration.status}` : ""}`
    : "";

  // The bar's own vocabulary. `label` is the sentence the bar leads with and
  // `why` the line under it — except when there is nothing to do, where the
  // helper's `label` is already the button ("Edit details") and `why` is the
  // sentence ("Record complete · last changed 4 Sep"), so the two swap over.
  const NEXT_ICON: Record<PersonActionKey, ReactNode> = {
    "apply-imports": <Clock className="h-4 w-4" aria-hidden />,
    "add-dob": <AlertTriangle className="h-4 w-4" aria-hidden />,
    "add-emergency-contact": <AlertTriangle className="h-4 w-4" aria-hidden />,
    "record-id-seen": <IdCard className="h-4 w-4" aria-hidden />,
    "record-complete": <UserRoundCheck className="h-4 w-4" aria-hidden />,
  };
  // A button says one thing. "Save a date of birth — 3 imports waiting" is the
  // sentence, not the press.
  const NEXT_BUTTON: Record<PersonActionKey, string> = {
    "apply-imports": "Add the date of birth",
    "add-dob": "Add a date of birth",
    "add-emergency-contact": "Add a contact",
    "record-id-seen": "Record ID seen",
    "record-complete": "Edit details",
  };
  const quiet = next.key === "record-complete";

  // Everything the panel might show, gathered once. Each mode is handed only
  // what it was given: the family tree, the subscriptions and the payments are
  // empty arrays unless THIS request asked for their mode.
  const sheetData: PersonSheetData = {
    person,
    personName: name,
    admin,
    superUser,
    pending,
    emergencyContacts,
    roles,
    guardianships,
    documents,
    documentUrls,
    verifierNames,
    billingAccount: billingRow?.billing_accounts ?? null,
    billingAccountId: billingRow?.account_id ?? null,
    memberNo,
    household: billingHousehold ?? [],
    clubMembership,
    familyOthers,
    familyNames,
    familyTree,
    familyTreeError: treeError?.message ?? null,
    treePhotoUrls,
    subscriptions,
    payments,
    subjectNames,
    snapshot,
    registrationSummary,
    photoConsents: isMinorDob(person.dob) ? photoConsents.get(id) : undefined,
    questionLabels,
  };

  return (
    <>
      <PageHeader
        title={name}
        subtitle={person.email ?? "No email on file"}
        back={{ href: backHref(from), label: "People" }}
        /* The face goes beside the name rather than on a row of its own, and
           only the EXCEPTIONS keep a badge: minor, login and membership kind
           are tiles on the band below now, where each has room to say what it
           means. That is most of the vertical space this page got back. */
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {person.deleted_at && <Badge variant="destructive">Retired</Badge>}
            {person.legal_hold && <Badge variant="warning">Legal hold</Badge>}
            <Avatar name={name} photoUrl={photoUrl} size="lg" />
          </div>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        <ActionBar
          icon={NEXT_ICON[next.key]}
          tone={next.tone}
          status={quiet ? next.why : next.label}
          detail={quiet ? undefined : next.why}
          action={
            <Link
              href={modeHrefs[next.mode]}
              className={buttonVariants({ size: "touch", variant: quiet ? "outline" : "default" })}
            >
              {NEXT_BUTTON[next.key]}
            </Link>
          }
        />

        <PersonFacts
          facts={{
            ageGroup: ageGroupFromDobString(person.dob),
            isMinor: isMinorDob(person.dob),
            hasDob: !!person.dob,
            loginRole: profileRow?.role ?? null,
            membershipWord: clubMembership?.kind ? membershipKindWord(clubMembership.kind) : null,
            membershipSeason: clubMembership?.season_name ?? null,
            memberNo,
            memberNoStatus:
              billingRow?.billing_accounts && billingRow.billing_accounts.status !== "active"
                ? billingRow.billing_accounts.status
                : null,
            roles: roles.length,
            guardians: guardianships.filter((link) => !link.personIsGuardian && !link.endedAt).length,
            children: guardianships.filter((link) => link.personIsGuardian && !link.endedAt).length,
            teams: teamRows.length,
            liveTeams,
            idSeen: person.id_verified,
            idNeeded: childFacingRoles.length > 0 && !person.id_verified,
            retired: !!person.deleted_at,
          }}
          hrefFor={(key) => {
            const target = FACT_MODE[key];
            return target ? modeHrefs[target] : "#person-teams";
          }}
        />

        {/* Every membership this person has held, in every season — the season
            heads its own group, so the six-column table that used to scroll
            sideways on a phone is gone. */}
        <Card id="person-teams" className="scroll-mt-20">
          <CardHeader className="pb-3">
            <CardTitle>Teams</CardTitle>
          </CardHeader>
          <CardContent>
            <PersonTeams rows={teamRows} />
          </CardContent>
        </Card>

        {/* The history folds beneath the work, the way every screen in the
            makeover ends. Each summary is real text, so the row is worth
            reading shut; what you CHANGE is a press away in the panel. */}
        <div className="space-y-2">
          <FoldCard
            icon={<History className="h-4 w-4" aria-hidden />}
            title="Record"
            summary={recordSummary}
          >
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Retiring a person hides them from the lists. It is a soft delete and always has
                been: the row, their history and every audit trail stay exactly where they are
                (SG-2).
              </p>
              {canAdmin ? (
                <Link
                  href={modeHrefs.danger}
                  className={buttonVariants({ variant: "outline", size: "touch" })}
                >
                  {person.deleted_at ? "Restore this person" : "Retire this person"}
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Only a club administrator can retire a record.
                </p>
              )}
            </div>
          </FoldCard>

          {snapshot && (
            <FoldCard
              icon={<FileText className="h-4 w-4" aria-hidden />}
              title="From the latest registration"
              summary={registrationSummary}
            >
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Read-only here: each new registration overwrites these answers, and they are
                  changed by registering again.
                </p>
                <RegistrationDetailsBody
                  details={snapshot.details}
                  photoConsents={
                    isMinorDob(person.dob) ? (photoConsents.get(id) ?? new Set<string>()) : undefined
                  }
                  questionLabels={questionLabels}
                />
              </div>
            </FoldCard>
          )}

          <FoldCard
            icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
            title="Proof of identity"
            summary={idSummary}
            defaultOpen={next.key === "record-id-seen"}
          >
            <div className="space-y-3">
              <IdentityDocumentList documents={documents} documentUrls={documentUrls} />
              <Link
                href={modeHrefs.identity}
                className={buttonVariants({ variant: "outline", size: "touch" })}
              >
                {person.id_verified ? "Change the ID record" : "Record ID seen"}
              </Link>
            </div>
          </FoldCard>
        </div>
      </div>

      <PersonSheet
        personName={name}
        mode={mode}
        closeHref={closeHref}
        modeHrefs={modeHrefs}
        canEdit={canEdit}
        canAdmin={canAdmin}
        isSuperUser={superUser}
      >
        {mode ? <PersonSheetBody mode={mode} data={sheetData} /> : null}
      </PersonSheet>
    </>
  );
}
