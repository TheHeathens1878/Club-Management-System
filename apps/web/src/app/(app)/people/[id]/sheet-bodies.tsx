import type { ReactNode } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";

import type { Database, Json } from "@club/db";

import { FamilyTreeView } from "@/components/family-tree-view";
import {
  EmergencyContactsPanel,
  GuardianshipsPanel,
  PurgePanel,
  RetirePanel,
  RolesPanel,
  type GuardianshipRow,
  type RoleRow,
} from "@/components/person/person-panels";
import { RegistrationDetailsBody } from "@/components/registration-details";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import type { EmergencyContact } from "@/lib/emergency-contacts";
import { isFamilyTreeEmpty, type FamilyTree } from "@/lib/family-tree";
import {
  membershipKindHint,
  membershipKindLabel,
  membershipKindVariant,
  membershipPeopleSummary,
  type PersonMembershipRow,
} from "@/lib/membership-kind";
import { addressToFields, formatStamp, isMinorDob } from "@/lib/people-display";
import { nameOf } from "@/lib/person";
import type { PersonSheetMode } from "@/lib/person-record-state";
import { idDocumentKindLabel } from "@/lib/registration-questions";
import { verifierName } from "@/lib/registration-verifiers";
import { formatCurrency } from "@/lib/utils";

import { IdVerifiedForm } from "../../registrations/decision-forms";
import { PersonForm } from "../person-form";

/**
 * What `PersonSheet` shows, one mode at a time (P8.3b).
 *
 * `/people/[id]` does the reading; this file does the drawing. It is a plain
 * server module, NOT `"use client"` — it composes the client panels that hold
 * the forms, and every one of those keeps the server action it always had. The
 * split exists so that the page can be read as "here is what this record is"
 * without 350 lines of panel markup in the middle of it.
 *
 * Each mode gets only what it was given. The family tree, the subscriptions
 * and the payments arrive EMPTY unless the page was asked for that mode, which
 * is the whole point of addressing the panel with `?sheet=`: a record opened to
 * read a phone number does not pay for a family tree and two money reads.
 */

type PeopleRow = Database["public"]["Tables"]["people"]["Row"];

type PendingImport = {
  id: number;
  kind: string;
  payload: Json | null;
  created_at: string;
  attempts: number;
  last_error: string | null;
};

type BillingAccount = {
  member_no: number;
  lead_person_id: string | null;
  status: string;
};

type HouseholdMember = {
  person_id: string | null;
  letter: string | null;
  people: { first_name: string; last_name: string } | null;
};

type SubscriptionRow = {
  id: string;
  person_id: string | null;
  payer_person_id: string | null;
  status: string | null;
  amount_due_pence: number | null;
  ended_at: string | null;
  subscription_plans: { name: string; billing: string | null; amount_pence: number | null } | null;
};

type PaymentRow = {
  id: string;
  amount_pence: number;
  paid_at: string | null;
  method: string | null;
  kind: string | null;
  refunded_pence: number | null;
};

export type IdentityDocument = {
  id: string;
  kind: string;
  storage_path: string | null;
  created_at: string;
  purge_after: string | null;
};

export type PersonSheetData = {
  person: PeopleRow;
  personName: string;
  /** The reader is a club administrator: the write panels are offered. */
  admin: boolean;
  /** The one account offered a permanent delete. */
  superUser: boolean;
  pending: PendingImport[];
  emergencyContacts: EmergencyContact[];
  roles: RoleRow[];
  guardianships: GuardianshipRow[];
  documents: IdentityDocument[];
  /** Signed URLs by storage path — empty for a reader who may not have them. */
  documentUrls: Map<string, string>;
  verifierNames: Map<string, string>;
  billingAccount: BillingAccount | null;
  billingAccountId: string | null;
  memberNo: string | null;
  household: HouseholdMember[];
  clubMembership: PersonMembershipRow | null;
  familyOthers: { person_id: string; is_primary: boolean | null }[];
  familyNames: Map<string, string>;
  familyTree: FamilyTree;
  familyTreeError: string | null;
  treePhotoUrls: Map<string, string>;
  subscriptions: SubscriptionRow[];
  payments: PaymentRow[];
  subjectNames: Map<string, string>;
  snapshot: { details: Json; seasonName: string | null; updatedAt: string | null } | null;
  /** The fold's one-line caption, reused as the panel's opening sentence. */
  registrationSummary: string;
  photoConsents: Set<string> | undefined;
  questionLabels: Map<string, string>;
};

/**
 * What the club holds, and until when. Shown on the record's fold and again
 * inside the panel where the tick lives, so it is a component rather than a
 * copy.
 */
export function IdentityDocumentList({
  documents,
  documentUrls,
}: {
  documents: IdentityDocument[];
  documentUrls: Map<string, string>;
}) {
  if (documents.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing on file.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {documents.map((document) => {
        const url = document.storage_path ? documentUrls.get(document.storage_path) : undefined;
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
              uploaded {formatStamp(document.created_at)} · destroyed {document.purge_after}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The queue payload `migrate_neon()` wrote, read defensively. */
function payloadField(payload: Json | null, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, Json | undefined>)[key];
  return typeof value === "string" ? value : null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-row font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function PersonSheetBody({
  mode,
  data,
}: {
  mode: PersonSheetMode;
  data: PersonSheetData;
}): ReactNode {
  const { person, personName, admin } = data;
  const personId = person.id;

  if (mode === "details") {
    return (
      <>
        {data.pending.length > 0 && (
          <Callout
            tone="warning"
            icon={<Clock className="h-4 w-4" aria-hidden />}
            title={`${data.pending.length} import${data.pending.length === 1 ? "" : "s"} waiting on a date of birth`}
            className="mb-4"
          >
            <ul className="space-y-1">
              {data.pending.map((row) => (
                <li key={row.id}>
                  <span className="font-medium capitalize">{row.kind}</span>
                  <span>
                    {payloadField(row.payload, "role")
                      ? ` · ${payloadField(row.payload, "role")}`
                      : ""}
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
        <PersonForm
          mode="edit"
          personId={personId}
          pendingImports={data.pending.length}
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
      </>
    );
  }

  if (mode === "contacts") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Up to two, kept on the person&apos;s record rather than on a registration form. Only a
          club administrator can change them here; the person and their guardians change them from
          their own screens.
        </p>
        <EmergencyContactsPanel
          personId={personId}
          personName={personName}
          contacts={data.emergencyContacts}
          canEdit={admin}
        />
      </div>
    );
  }

  if (mode === "roles") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The real role model — <code>person_roles</code>, not the login&apos;s
          <code> profiles.role</code>. Only a club administrator may grant or revoke, and every
          change is written to the audit log by a trigger.
        </p>
        <RolesPanel personId={personId} roles={data.roles} />
      </div>
    );
  }

  if (mode === "guardianships") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          SG-4. A guardian must be an adult with a known date of birth and a child must be a minor,
          so the database refuses the rest and says why. Links end; they are not deleted, and
          turning 18 is not an ending — the reading policies lapse on their own.
        </p>
        <GuardianshipsPanel
          personId={personId}
          personName={personName}
          links={data.guardianships}
        />
      </div>
    );
  }

  if (mode === "identity") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          A passport or birth certificate is asked for at registration unless a club administrator
          has recorded that the club has already seen one. Documents are held for three years and
          then destroyed automatically; the record that one was held survives.
        </p>
        <IdentityDocumentList documents={data.documents} documentUrls={data.documentUrls} />
        {admin ? (
          <IdVerifiedForm
            personId={personId}
            verified={person.id_verified}
            verifiedAt={person.id_verified_at}
            verifiedByName={
              person.id_verified ? verifierName(data.verifierNames, person.id_verified_by) : null
            }
          />
        ) : (
          person.id_verified && (
            <p className="text-sm text-success">
              ID seen and verified by {verifierName(data.verifierNames, person.id_verified_by)}
              {person.id_verified_at ? ` · ${formatStamp(person.id_verified_at)}` : ""}
            </p>
          )
        )}
      </div>
    );
  }

  if (mode === "membership") {
    const account = data.billingAccount;
    const membership = data.clubMembership;
    return (
      <div className="space-y-5">
        {account && (
          <Section title="Membership number">
            <p className="text-sm text-muted-foreground">
              The household number this person is billed under. Every charge lands on the lead
              member (the bill-payer); each person keeps their own card letter.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xl font-bold tabular-nums">{data.memberNo}</span>
              {account.status !== "active" && <Badge variant="muted">{account.status}</Badge>}
              {account.lead_person_id === personId ? (
                <Badge>Lead member · bill-payer</Badge>
              ) : (
                <Link
                  href={`/people/${account.lead_person_id}?sheet=membership`}
                  className="touch flex items-center text-sm font-medium underline underline-offset-2"
                >
                  Billed to the lead member →
                </Link>
              )}
            </div>
            <ul className="space-y-1 text-sm">
              {data.household.map((member) => (
                <li key={member.person_id} className="flex items-center gap-2">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {String(account.member_no).padStart(5, "0")}
                    {member.letter}
                  </span>
                  {member.person_id === personId ? (
                    <span className="font-medium">
                      {member.people
                        ? `${member.people.first_name} ${member.people.last_name}`
                        : "(unknown)"}
                    </span>
                  ) : (
                    <Link
                      href={`/people/${member.person_id}?sheet=membership`}
                      className="touch flex items-center font-medium underline underline-offset-2"
                    >
                      {member.people
                        ? `${member.people.first_name} ${member.people.last_name}`
                        : "(unknown)"}
                    </Link>
                  )}
                  {member.person_id === account.lead_person_id && (
                    <Badge variant="muted">lead</Badge>
                  )}
                </li>
              ))}
            </ul>
            <Link
              href={`/finance/charges?account=${data.billingAccountId}`}
              className="touch flex items-center text-xs text-muted-foreground underline"
            >
              Charges &amp; payments for this membership (Finance)
            </Link>
          </Section>
        )}

        <Section title="Club membership">
          <p className="text-sm text-muted-foreground">
            Individual or family is worked out by the database from the number of{" "}
            <strong>players</strong> on the membership in that season — a live squad place, or a
            registration still pending or approved. Two or more players is a family; a parent who is
            on the record as the lead contact is not a player.
          </p>
          {!membership || !membership.kind ? (
            <p className="text-sm text-muted-foreground">
              No club membership recorded for this person.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={membershipKindVariant(membership.kind)}>
                  {membershipKindLabel(membership.kind)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {membership.season_name ?? "Season unknown"}
                  {membership.season_is_current ? " · current season" : ""}
                  {membership.is_primary ? " · lead contact" : ""}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {membershipKindHint(membership.kind)}{" "}
                {membershipPeopleSummary(data.familyOthers.length)}
              </p>
              {data.familyOthers.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {data.familyOthers.map((row) => (
                    <li key={row.person_id} className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/people/${row.person_id}`}
                        className="touch flex items-center font-medium underline underline-offset-2"
                      >
                        {nameOf(data.familyNames, row.person_id)}
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
        </Section>

        {/* Adam, 2026-08-26: "The family tree should appear in here." Drawn by
            the same component /family-linking uses, from family_tree_for()
            rather than my_family_tree() — the caller-scoped one would draw the
            ADMINISTRATOR'S own family under this person's name. */}
        <Section title="Family">
          <p className="text-sm text-muted-foreground">
            {personName} at the top, the children the club has them down as a guardian for, each of
            those children&apos;s other guardians, and the adults connected to their account. Ages
            are shown as an age group rather than a date of birth.
          </p>
          {data.familyTreeError ? (
            <p className="text-sm text-destructive">{data.familyTreeError}</p>
          ) : isFamilyTreeEmpty(data.familyTree) ? (
            <p className="text-sm text-muted-foreground">
              The club has nobody linked to {personName}.
            </p>
          ) : (
            <FamilyTreeView
              tree={data.familyTree}
              photoUrls={data.treePhotoUrls}
              hrefFor={(node) => (node.personId === personId ? null : `/people/${node.personId}`)}
            />
          )}
        </Section>
      </div>
    );
  }

  if (mode === "money") {
    return (
      <div className="space-y-5">
        <Section title="Subscriptions">
          <p className="text-sm text-muted-foreground">
            What {personName} is signed up to pay, and anything they pay on somebody else&apos;s
            behalf.
          </p>
          {data.subscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subscription on record for {personName}.
            </p>
          ) : (
            <ul className="divide-y">
              {data.subscriptions.map((row) => {
                const plan = row.subscription_plans;
                const forSomeoneElse = row.person_id !== personId;
                return (
                  <li key={row.id} className="flex flex-wrap items-baseline gap-2 py-2 text-sm">
                    <span className="font-medium">{plan?.name ?? "Subscription"}</span>
                    <Badge variant={row.ended_at ? "muted" : "success"}>
                      {row.ended_at ? "Ended" : (row.status ?? "Active")}
                    </Badge>
                    {forSomeoneElse && row.person_id && (
                      <span className="text-xs text-muted-foreground">
                        for {nameOf(data.subjectNames, row.person_id)}
                      </span>
                    )}
                    <span className="ml-auto tabular-nums">
                      {row.amount_due_pence != null ? formatCurrency(row.amount_due_pence) : "—"}
                      {plan?.billing ? ` · ${plan.billing}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Payments">
          <p className="text-sm text-muted-foreground">
            Against the subscriptions above. Room hire is paid on the booking, not here.
          </p>
          {data.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing paid yet.</p>
          ) : (
            <ul className="divide-y">
              {data.payments.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline gap-2 py-2 text-sm">
                  <span className="tabular-nums">{formatCurrency(row.amount_pence)}</span>
                  {row.refunded_pence ? (
                    <Badge variant="warning">{formatCurrency(row.refunded_pence)} refunded</Badge>
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
        </Section>
      </div>
    );
  }

  if (mode === "registration") {
    return data.snapshot ? (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {data.registrationSummary}. Read-only here: each new registration overwrites these
          answers, and they are changed by registering again.
        </p>
        <RegistrationDetailsBody
          details={data.snapshot.details}
          photoConsents={isMinorDob(person.dob) ? (data.photoConsents ?? new Set<string>()) : undefined}
          questionLabels={data.questionLabels}
        />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">
        No registration answers are on this record, or you are not entitled to see them.
      </p>
    );
  }

  // danger
  return (
    <div className="space-y-3">
      <RetirePanel personId={personId} personName={personName} deletedAt={person.deleted_at} />
      {/* Adam, the club owner and sole super user, asked for a real delete for
          GDPR erasure and for test accounts. Nobody else is offered it, and
          `purge_person()` would refuse them anyway. */}
      {data.superUser && <PurgePanel personId={personId} personName={personName} />}
    </div>
  );
}
