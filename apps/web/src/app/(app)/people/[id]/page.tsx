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

import type { Json } from "@club/db";

import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ActionBar } from "@/components/ui/action-bar";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FoldCard } from "@/components/ui/fold-card";
import { PersonFacts, type PersonFactKey } from "@/components/person/person-facts";
import { PersonTeams, type PersonTeamRow } from "@/components/person/person-teams";
import { getSessionProfile, isCommittee, isSuperUser } from "@/lib/auth";
import { signPeoplePhotos, signPersonPhotoPath } from "@/lib/avatars";
import { signIdentityDocumentPaths } from "@/lib/identity-docs";
import {
  currentMembership,
  membershipKindHint,
  membershipKindLabel,
  membershipKindVariant,
  membershipKindWord,
  membershipPeopleSummary,
  type PersonMembershipRow,
} from "@/lib/membership-kind";
import { isClubAdmin, resolveNames, nameOf } from "@/lib/person";
import {
  personNextAction,
  type PersonActionKey,
  type PersonSheetMode,
} from "@/lib/person-record-state";
import { idDocumentKindLabel } from "@/lib/registration-questions";
import {
  RegistrationDetailsBody,
  registrationDetailsCaption,
} from "@/components/registration-details";
import {
  loadLivePhotoConsents,
  loadRegistrationDetails,
} from "@/lib/registration-details-server";
import { resolveUserNames, verifierName } from "@/lib/registration-verifiers";
import {
  addressToFields,
  formatDate,
  formatStamp,
  isMinorDob,
  personLabel,
} from "@/lib/people-display";
import { ageGroupFromDobString } from "@/lib/waiting-list";
import { createClient } from "@/lib/supabase/server";
import { FamilyTreeView } from "@/components/family-tree-view";
import { parseFamilyTree, familyTreePersonIds, isFamilyTreeEmpty } from "@/lib/family-tree";
import { formatCurrency } from "@/lib/utils";

import { PersonTabs, personTabFrom } from "./person-tabs";

import { IdVerifiedForm } from "../../registrations/decision-forms";
import { PersonForm } from "../person-form";
import { loadEmergencyContacts } from "@/lib/emergency-contacts-server";

import {
  EmergencyContactsPanel,
  GuardianshipsPanel,
  PurgePanel,
  RetirePanel,
  RolesPanel,
  type GuardianshipRow,
  type RoleRow,
} from "@/components/person/person-panels";

/**
 * One person's record (gap 2), as one object with a status line (P8.3).
 *
 *   1. THE STATUS BAR — the ONE thing this record needs next, from
 *      `personNextAction()`: imports the migration cannot apply, a missing
 *      date of birth, a child with nobody to ring, an adult in a child-facing
 *      role whose ID nobody has recorded seeing — or, when there is nothing
 *      outstanding, "Record complete" and the ordinary door into the details.
 *   2. THE FACTS BAND — the eight things an administrator opened the record to
 *      find out, each one press from the place it is changed.
 *   3. THE PANELS, then FOLDED BENEATH — the record itself, what the latest
 *      registration said, and the proof of identity. Each fold's closed line
 *      is real text, computed here, so it is worth reading shut.
 *
 * Everything is read through the caller's own client. Where a policy says no —
 * `registrations.form` is club_admin, safeguarding_lead, the subject or their
 * guardian, and nobody else — the read simply returns nothing and the section
 * is not rendered. That is the intended behaviour: the page shows what the
 * caller is entitled to see, and works out nothing for itself. The facts band
 * inherits the rule: an absent membership number is a reader who was not shown
 * the billing row, not a person without one.
 *
 * THE CLUB MEMBERSHIP CARD (Adam, 2026-08-26) is the same rule: it reads
 * `person_memberships`, a security_invoker view over `memberships` and
 * `membership_people`, so it renders only for a reader those policies already
 * admit (the lead contact, club_admin, safeguarding_lead). Individual or
 * Family is the DATABASE's answer, derived from the number of PLAYERS on the
 * membership in that season, and the card lists the other people on it so an
 * administrator can click straight through to the rest of the family.
 */

// The person's own name would be the obvious tab title and is exactly what
// must not go there: a browser tab, a screen share and a history entry are all
// places a member's name would travel further than the page itself.
export const metadata = { title: "Member record" };

/** The queue payload `migrate_neon()` wrote, read defensively. */
function payloadField(payload: Json | null, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, Json | undefined>)[key];
  return typeof value === "string" ? value : null;
}

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

/** The two sections that live on the Membership and payments tab. */
const MEMBERSHIP_TAB_SECTIONS = new Set(["membership", "money", "member-no"]);

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; tab?: string | string[] }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/lobby");

  const { id } = await params;
  const { from, tab: rawTab } = await searchParams;
  const tab = personTabFrom(rawTab);
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
  // security_invoker RLS, so a reader who may not see the membership sees no
  // card at all rather than a card with the names missing.
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
  // holds the finance gate; a reader without it simply sees no number card.
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

  // The Membership and payments tab. Only loaded when it is the tab being
  // shown — a record opened to read a phone number should not pay for a family
  // tree and two money reads.
  //
  // `family_tree_for()` (20260827130000) is the person-shaped twin of
  // `my_family_tree()`: asking the caller-scoped one here would draw the
  // ADMINISTRATOR'S own family under somebody else's name. It refuses anyone
  // who is not club_admin or safeguarding_lead, which is the readership this
  // page already requires.
  const membershipTab = tab === "membership";
  const { data: treeData, error: treeError } = membershipTab
    ? await supabase.rpc("family_tree_for", { p_person_id: id })
    : { data: null, error: null };
  const familyTree = parseFamilyTree(treeData ?? null);

  const treePhotoIds = membershipTab ? familyTreePersonIds(familyTree) : [];
  const { data: treePhotoRows } =
    treePhotoIds.length > 0
      ? await supabase.from("people").select("id,photo_path").in("id", treePhotoIds)
      : { data: [] as { id: string; photo_path: string | null }[] };
  const treePhotoUrls = await signPeoplePhotos(treePhotoRows ?? []);

  // Subscriptions this person is the SUBJECT of, and the ones they PAY for —
  // a parent's record should show the bills they carry for their children.
  const { data: subscriptionRows } = membershipTab
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
    membershipTab && subscriptions.length > 0
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
  // back and the card is not rendered. The SG-5 photo consents beside it are
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
  // What this record needs next, and where every tile goes
  // -------------------------------------------------------------------------

  const next = personNextAction({
    person: { dob: person.dob, id_verified: person.id_verified, updated_at: person.updated_at },
    pendingImports: pending.length,
    emergencyContacts: emergencyContacts.length,
    childFacingRoles,
    identityDocuments: documents.length,
  });

  /**
   * Every press on this page is a URL. A section on the tab already open is a
   * plain anchor; one on the other tab carries `?tab=` so the press lands with
   * the right half of the record on screen. `from` rides along so Back still
   * returns to the list the reader came from.
   *
   * These become `?sheet=<mode>` when the sheet lands; the keys do not move.
   */
  function sectionHref(section: string): string {
    const onMembershipTab = MEMBERSHIP_TAB_SECTIONS.has(section);
    const query = new URLSearchParams();
    if (onMembershipTab) query.set("tab", "membership");
    if (from) query.set("from", from);
    const text = query.toString();
    return `/people/${id}${text ? `?${text}` : ""}#person-${section}`;
  }

  const FACT_SECTIONS: Record<PersonFactKey, string> = {
    age: "details",
    login: "details",
    membership: "membership",
    memberNo: "member-no",
    roles: "roles",
    guardianships: "guardianships",
    teams: "teams",
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
  const NEXT_SECTION: Record<PersonSheetMode, string> = {
    details: "details",
    contacts: "contacts",
    roles: "roles",
    guardianships: "guardianships",
    identity: "identity",
    membership: "membership",
    money: "money",
    registration: "registration",
    danger: "danger",
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
              href={sectionHref(NEXT_SECTION[next.mode])}
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
          hrefFor={(key) => sectionHref(FACT_SECTIONS[key])}
        />

        <PersonTabs personId={person.id} active={tab} from={from} />

        {tab === "record" && (
        <>
        {pending.length > 0 && (
          <Callout
            tone="warning"
            icon={<Clock className="h-4 w-4" aria-hidden />}
            title="Waiting to be applied"
          >
            <p>
              Records imported from the pitch-booking app that SG-4 and SG-6 will not accept until
              this person&apos;s date of birth is known. Save a date of birth below and they are
              applied straight away.
            </p>
            <ul className="mt-2 space-y-1">
              {pending.map((row) => (
                <li key={row.id}>
                  <span className="font-medium capitalize">{row.kind}</span>
                  <span>
                    {payloadField(row.payload, "role") ? ` · ${payloadField(row.payload, "role")}` : ""}
                    {` · queued ${formatStamp(row.created_at)}`}
                    {row.attempts > 0
                      ? ` · ${row.attempts} attempt${row.attempts === 1 ? "" : "s"}`
                      : ""}
                  </span>
                  {row.last_error && <span className="block text-xs">{row.last_error}</span>}
                </li>
              ))}
            </ul>
          </Callout>
        )}

        <Card id="person-details" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <PersonForm
              mode="edit"
              personId={person.id}
              pendingImports={pending.length}
              values={{
                first_name: person.first_name,
                last_name: person.last_name,
                preferred_name: person.preferred_name ?? "",
                dob: person.dob ?? "",
                sex: person.sex ?? "",
                email: person.email ?? "",
                phone: person.phone ?? "",
                address: addressToFields(person.address),
                notes: person.notes ?? "",
              }}
            />
          </CardContent>
        </Card>

        <Card id="person-contacts" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Emergency contacts</CardTitle>
            <p className="text-sm text-muted-foreground">
              Up to two, kept on the person&apos;s record rather than on a registration form.
              Only a club administrator can change them here; the person and their guardians
              change them from their own screens.
            </p>
          </CardHeader>
          <CardContent>
            <EmergencyContactsPanel
              personId={person.id}
              personName={name}
              contacts={emergencyContacts}
              canEdit={admin}
            />
          </CardContent>
        </Card>

        <Card id="person-roles" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Roles</CardTitle>
            <p className="text-sm text-muted-foreground">
              The real role model — <code>person_roles</code>, not the login&apos;s
              <code> profiles.role</code>. Only a club administrator may grant or revoke, and every
              change is written to the audit log by a trigger.
            </p>
          </CardHeader>
          <CardContent>
            <RolesPanel personId={person.id} roles={roles} />
          </CardContent>
        </Card>

        <Card id="person-guardianships" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Guardianships</CardTitle>
            <p className="text-sm text-muted-foreground">
              SG-4. A guardian must be an adult with a known date of birth and a child must be a
              minor, so the database refuses the rest and says why. Links end; they are not deleted,
              and turning 18 is not an ending — the reading policies lapse on their own.
            </p>
          </CardHeader>
          <CardContent>
            <GuardianshipsPanel personId={person.id} personName={name} links={guardianships} />
          </CardContent>
        </Card>

        {/* Every membership this person has held, in every season — the
            season heads its own group, so the six-column table that used to
            scroll sideways on a phone is gone. */}
        <Card id="person-teams" className="scroll-mt-20">
          <CardHeader className="pb-3">
            <CardTitle>Teams</CardTitle>
          </CardHeader>
          <CardContent>
            <PersonTeams rows={teamRows} />
          </CardContent>
        </Card>

        {/* The settings and the history fold beneath the work, the way every
            screen in the makeover ends. Each summary is real text, so the row
            is worth reading without opening it. */}
        <div className="space-y-2 pt-2">
          <FoldCard
            icon={<History className="h-4 w-4" aria-hidden />}
            title="Record"
            summary={recordSummary}
            className="scroll-mt-20"
          >
            <div id="person-danger" className="scroll-mt-20">
              <RetirePanel
                personId={person.id}
                personName={name}
                deletedAt={person.deleted_at}
              />
              {/* Adam, the club owner and sole super user, asked for a real
                  delete for GDPR erasure and for test accounts. Nobody else is
                  offered it, and `purge_person()` would refuse them anyway. */}
              {isSuperUser(session.profile?.role) && (
                <PurgePanel personId={person.id} personName={name} />
              )}
            </div>
          </FoldCard>

          {snapshot && (
            <FoldCard
              icon={<FileText className="h-4 w-4" aria-hidden />}
              title="From the latest registration"
              summary={registrationSummary}
              className="scroll-mt-20"
            >
              <div id="person-registration" className="scroll-mt-20 space-y-3">
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
            className="scroll-mt-20"
          >
            <div id="person-identity" className="scroll-mt-20 space-y-3">
              <p className="text-sm text-muted-foreground">
                A passport or birth certificate is asked for at registration unless a club
                administrator has recorded that the club has already seen one. Documents are held
                for three years and then destroyed automatically; the record that one was held
                survives.
              </p>
              {documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing on file.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {documents.map((document) => {
                    const url = document.storage_path
                      ? documentUrls.get(document.storage_path)
                      : undefined;
                    return (
                      <li key={document.id} className="flex flex-wrap items-center gap-2">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="touch flex items-center font-medium text-primary hover:underline"
                          >
                            {idDocumentKindLabel(document.kind)}
                          </a>
                        ) : (
                          <span className="font-medium">{idDocumentKindLabel(document.kind)}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          uploaded {formatStamp(document.created_at)} · destroyed{" "}
                          {document.purge_after}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {admin ? (
                <IdVerifiedForm
                  personId={person.id}
                  verified={person.id_verified}
                  verifiedAt={person.id_verified_at}
                  verifiedByName={
                    person.id_verified ? verifierName(verifierNames, person.id_verified_by) : null
                  }
                />
              ) : (
                person.id_verified && (
                  <p className="text-sm text-success">
                    ID seen and verified by {verifierName(verifierNames, person.id_verified_by)}
                    {person.id_verified_at ? ` · ${formatStamp(person.id_verified_at)}` : ""}
                  </p>
                )
              )}
            </div>
          </FoldCard>
        </div>
        </>
        )}

        {tab === "membership" && (
          <>
        {billingRow?.billing_accounts && (
          <Card id="person-member-no" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>Membership number</CardTitle>
              <p className="text-sm text-muted-foreground">
                The household number this person is billed under. Every charge lands on the lead
                member (the bill-payer); each person keeps their own card letter.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xl font-bold tabular-nums">
                  {String(billingRow.billing_accounts.member_no).padStart(5, "0")}
                  {billingRow.letter}
                </span>
                {billingRow.billing_accounts.status !== "active" && (
                  <Badge variant="muted">{billingRow.billing_accounts.status}</Badge>
                )}
                {billingRow.billing_accounts.lead_person_id === id ? (
                  <Badge>Lead member · bill-payer</Badge>
                ) : (
                  <Link
                    href={`/people/${billingRow.billing_accounts.lead_person_id}?tab=membership`}
                    className="touch flex items-center text-sm font-medium underline underline-offset-2"
                  >
                    Billed to the lead member →
                  </Link>
                )}
              </div>
              <ul className="space-y-1 text-sm">
                {(billingHousehold ?? []).map((member) => (
                  <li key={member.person_id} className="flex items-center gap-2">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {String(billingRow.billing_accounts!.member_no).padStart(5, "0")}
                      {member.letter}
                    </span>
                    {member.person_id === id ? (
                      <span className="font-medium">
                        {member.people ? `${member.people.first_name} ${member.people.last_name}` : "(unknown)"}
                      </span>
                    ) : (
                      <Link
                        href={`/people/${member.person_id}?tab=membership`}
                        className="touch flex items-center font-medium underline underline-offset-2"
                      >
                        {member.people ? `${member.people.first_name} ${member.people.last_name}` : "(unknown)"}
                      </Link>
                    )}
                    {member.person_id === billingRow.billing_accounts!.lead_person_id && (
                      <Badge variant="muted">lead</Badge>
                    )}
                  </li>
                ))}
              </ul>
              <Link
                href={`/finance/charges?account=${billingRow.account_id}`}
                className="text-xs text-muted-foreground underline"
              >
                Charges &amp; payments for this membership (Finance)
              </Link>
            </CardContent>
          </Card>
        )}

        <Card id="person-membership" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Club membership</CardTitle>
            <p className="text-sm text-muted-foreground">
              Individual or family is worked out by the database from the number of{" "}
              <strong>players</strong> on the membership in that season — a live squad place, or a
              registration still pending or approved. Two or more players is a family; a parent who
              is on the record as the lead contact is not a player.
            </p>
          </CardHeader>
          <CardContent>
            {!clubMembership || !clubMembership.kind ? (
              <p className="text-sm text-muted-foreground">
                No club membership recorded for this person.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={membershipKindVariant(clubMembership.kind)}>
                    {membershipKindLabel(clubMembership.kind)}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {clubMembership.season_name ?? "Season unknown"}
                    {clubMembership.season_is_current ? " · current season" : ""}
                    {clubMembership.is_primary ? " · lead contact" : ""}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {membershipKindHint(clubMembership.kind)}{" "}
                  {membershipPeopleSummary(familyOthers.length)}
                </p>
                {familyOthers.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {familyOthers.map((row) => (
                      <li key={row.person_id} className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/people/${row.person_id}`}
                          className="touch flex items-center font-medium underline underline-offset-2"
                        >
                          {nameOf(familyNames, row.person_id)}
                        </Link>
                        <Badge variant={row.is_primary ? "default" : "muted"}>
                          {row.is_primary ? "Lead contact" : "On the membership"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

            {/* Adam, 2026-08-26: "The family tree should appear in here."
                Drawn by the same component /family-linking uses, from
                family_tree_for() rather than my_family_tree() — the
                caller-scoped one would draw the ADMINISTRATOR'S own family
                under this person's name. */}
            <Card>
              <CardHeader>
                <CardTitle>Family</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {name} at the top, the children the club has them down as a guardian for, each of
                  those children&apos;s other guardians, and the adults connected to their account.
                  Ages are shown as an age group rather than a date of birth.
                </p>
              </CardHeader>
              <CardContent>
                {treeError ? (
                  <p className="text-sm text-destructive">{treeError.message}</p>
                ) : isFamilyTreeEmpty(familyTree) ? (
                  <p className="text-sm text-muted-foreground">
                    The club has nobody linked to {name}.
                  </p>
                ) : (
                  <FamilyTreeView
                    tree={familyTree}
                    photoUrls={treePhotoUrls}
                    hrefFor={(node) =>
                      node.personId === person.id ? null : `/people/${node.personId}`
                    }
                  />
                )}
              </CardContent>
            </Card>

            <Card id="person-money" className="scroll-mt-20">
              <CardHeader>
                <CardTitle>Subscriptions</CardTitle>
                <p className="text-sm text-muted-foreground">
                  What {name} is signed up to pay, and anything they pay on somebody else&apos;s
                  behalf.
                </p>
              </CardHeader>
              <CardContent>
                {subscriptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No subscription on record for {name}.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {subscriptions.map((row) => {
                      const plan = row.subscription_plans as {
                        name: string;
                        billing: string | null;
                        amount_pence: number | null;
                      } | null;
                      const forSomeoneElse = row.person_id !== person.id;
                      return (
                        <li key={row.id} className="flex flex-wrap items-baseline gap-2 py-2 text-sm">
                          <span className="font-medium">{plan?.name ?? "Subscription"}</span>
                          <Badge variant={row.ended_at ? "muted" : "success"}>
                            {row.ended_at ? "Ended" : (row.status ?? "Active")}
                          </Badge>
                          {forSomeoneElse && row.person_id && (
                            <span className="text-xs text-muted-foreground">
                              for {nameOf(subjectNames, row.person_id)}
                            </span>
                          )}
                          <span className="ml-auto tabular-nums">
                            {row.amount_due_pence != null
                              ? formatCurrency(row.amount_due_pence)
                              : "—"}
                            {plan?.billing ? ` · ${plan.billing}` : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Payments</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Against the subscriptions above. Room hire is paid on the booking, not here.
                </p>
              </CardHeader>
              <CardContent>
                {payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing paid yet.</p>
                ) : (
                  <ul className="divide-y">
                    {payments.map((row) => (
                      <li key={row.id} className="flex flex-wrap items-baseline gap-2 py-2 text-sm">
                        <span className="tabular-nums">{formatCurrency(row.amount_pence)}</span>
                        {row.refunded_pence ? (
                          <Badge variant="warning">
                            {formatCurrency(row.refunded_pence)} refunded
                          </Badge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {row.method ?? "—"}
                          {row.kind ? ` · ${row.kind}` : ""}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {row.paid_at ? formatStamp(row.paid_at) : "Not paid"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
