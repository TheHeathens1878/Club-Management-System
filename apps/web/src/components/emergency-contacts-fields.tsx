"use client";

/**
 * The emergency-contacts fieldset (Adam, 2026-08-25): up to two people, kept
 * on the person's record. Shared by the join wizard, the family screen, My
 * Profile and the admin person page — the parser in `lib/emergency-contacts`
 * reads exactly what this renders.
 *
 * `lead` offers "I am the first emergency contact" (Adam: "Emergency contact
 * can be lead contact also, so a tick button would be helpful"). Ticked, the
 * name and number for contact 1 are not rendered at all — the server copies
 * them from the caller's own record — which is also what makes the server's
 * rule safe: a typed contact 1 can only arrive when the box was unticked.
 */

import { useState } from "react";

import { Input, Label } from "@/components/ui/input";
import {
  MAX_EMERGENCY_CONTACTS,
  USE_LEAD_FIELD,
  contactField,
  type EmergencyContact,
} from "@/lib/emergency-contacts";

export type LeadContact = { name: string; phone: string | null };

export function EmergencyContactsFields({
  idPrefix,
  initial,
  lead,
  personName,
  requireFirst = true,
}: {
  idPrefix: string;
  initial: EmergencyContact[];
  /** The signed-in adult, when they may stand as contact 1 for this person. */
  lead: LeadContact | null;
  /** Whose contacts these are — "Alfie's emergency contacts". */
  personName: string;
  /** Contact 1 is mandatory (registration); optional on a plain profile edit. */
  requireFirst?: boolean;
}) {
  const first = initial.find((contact) => contact.position === 1) ?? null;
  const leadIsFirst =
    !!lead && !!lead.phone && !!first && first.name === lead.name && first.phone === lead.phone;
  // Ticked by default when there is nothing on record yet (the common case,
  // and the one the box exists to make one click long) or when contact 1 is
  // already the lead. A lead with no phone cannot be chosen — the hint says
  // where to add one.
  const [useLead, setUseLead] = useState(!!lead && !!lead.phone && (!first || leadIsFirst));

  const rows = Array.from({ length: MAX_EMERGENCY_CONTACTS }, (_, index) => {
    const position = index + 1;
    return initial.find((contact) => contact.position === position) ?? null;
  });

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Emergency contacts</legend>
      <p className="text-xs text-muted-foreground">
        Up to two people the club can ring about {personName}. They are kept on {personName}
        &rsquo;s record rather than on a registration form, so they are asked for once and can be
        changed at any time.
      </p>

      {lead && (
        <label className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <input
            type="checkbox"
            name={USE_LEAD_FIELD}
            value="yes"
            checked={useLead}
            onChange={(event) => setUseLead(event.target.checked)}
            disabled={!lead.phone}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            I am the first emergency contact
            <span className="block text-xs text-muted-foreground">
              {lead.phone
                ? `${lead.name} · ${lead.phone}`
                : "Your own phone number is not on record yet — add it on My profile, or type the contact below."}
            </span>
          </span>
        </label>
      )}

      {rows.map((contact, index) => {
        const position = index + 1;
        const leadHere = position === 1 && useLead;
        const required = position === 1 && requireFirst && !leadHere;
        // When contact 1 on record IS the lead, the typed fields start empty
        // rather than echoing the lead's details — unticking means "someone
        // else", and pre-filling the lead would post them as a typed contact.
        const prefill = position === 1 && leadIsFirst ? null : contact;
        return (
          <div key={position} className="space-y-2 rounded-lg border bg-secondary/20 p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Contact {position}
              {position === 2 ? " (optional)" : ""}
            </p>
            {!leadHere && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-ec${position}-first-name`}>
                    First name {required && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id={`${idPrefix}-ec${position}-first-name`}
                    name={contactField(position, "first_name")}
                    defaultValue={prefill?.firstName ?? ""}
                    required={required}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-ec${position}-last-name`}>
                    Last name {required && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id={`${idPrefix}-ec${position}-last-name`}
                    name={contactField(position, "last_name")}
                    defaultValue={prefill?.lastName ?? ""}
                    required={required}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-ec${position}-phone`}>
                    Phone {required && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id={`${idPrefix}-ec${position}-phone`}
                    name={contactField(position, "phone")}
                    type="tel"
                    defaultValue={prefill?.phone ?? ""}
                    required={required}
                    autoComplete="off"
                  />
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-ec${position}-rel`}>
                {leadHere ? `Your relationship to ${personName}` : "Relationship"}
              </Label>
              <Input
                id={`${idPrefix}-ec${position}-rel`}
                name={contactField(position, "relationship")}
                defaultValue={contact?.relationship ?? ""}
                placeholder="Mother, father, grandparent…"
                autoComplete="off"
              />
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
