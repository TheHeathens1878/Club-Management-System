"use client";

/**
 * The emergency-contacts fieldset (Adam, 2026-08-25): up to two people, kept
 * on the person's record. Shared by the join wizard, the family screen, My
 * Profile and the admin person page — the parser in `lib/emergency-contacts`
 * reads exactly what this renders.
 *
 * `lead` offers "I am the first emergency contact" (Adam: "Emergency contact
 * can be lead contact also, so a tick button would be helpful"). Ticked, the
 * fields for contact 1 are not rendered at all — the server copies the name
 * and number from the caller's own record and LINKS the row to it, so the
 * date of birth, sex, email and address the FA Clubs Portal asks for are
 * read from there — which is also what makes the server's rule safe: a typed
 * contact 1 can only arrive when the box was unticked.
 *
 * A typed contact carries the Portal's fields too (Adam, 2026-09-06: "the
 * above information needs to be collected for emergency contacts even if
 * they aren't the lead booker"). The postcode is required as soon as any of
 * the address is; on a registration the whole address is.
 */

import { useState } from "react";

import { DateOfBirthInput } from "@/components/date-of-birth-input";
import { Select } from "@/components/ui/field";
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
        Who the club rings if something happens to {personName} — an injury at training, or
        anything at a match that means somebody has to be told now. Up to two, and the first is
        tried first. They are kept on {personName}&rsquo;s record rather than on a registration
        form, so they are asked for once and can be changed at any time. The FA Clubs Portal
        registers a parent or carer with their date of birth, sex, email and address, so those are
        asked here too.
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
                ? `${lead.name} · ${lead.phone} — your own date of birth, email and address are used from your record.`
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
        const id = (key: string): string => `${idPrefix}-ec${position}-${key}`;
        return (
          <div key={position} className="space-y-2 rounded-lg border bg-secondary/20 p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Contact {position}
              {position === 2 ? " (optional)" : ""}
            </p>
            {!leadHere && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={id("first-name")}>
                      First name {required && <span className="text-destructive">*</span>}
                    </Label>
                    <Input
                      id={id("first-name")}
                      name={contactField(position, "first_name")}
                      defaultValue={prefill?.firstName ?? ""}
                      required={required}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={id("last-name")}>
                      Last name {required && <span className="text-destructive">*</span>}
                    </Label>
                    <Input
                      id={id("last-name")}
                      name={contactField(position, "last_name")}
                      defaultValue={prefill?.lastName ?? ""}
                      required={required}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={id("phone")}>
                      Mobile {required && <span className="text-destructive">*</span>}
                    </Label>
                    <Input
                      id={id("phone")}
                      name={contactField(position, "phone")}
                      type="tel"
                      defaultValue={prefill?.phone ?? ""}
                      required={required}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={id("email")}>Email</Label>
                    <Input
                      id={id("email")}
                      name={contactField(position, "email")}
                      type="email"
                      defaultValue={prefill?.email ?? ""}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={id("dob")}>Date of birth</Label>
                    <DateOfBirthInput
                      id={id("dob")}
                      name={contactField(position, "dob")}
                      defaultValue={prefill?.dob ?? ""}
                      start="adult"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={id("sex")}>Sex</Label>
                    <Select id={id("sex")} name={contactField(position, "sex")} defaultValue={prefill?.sex ?? ""}>
                      <option value="">Not said</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={id("line1")}>Address line 1</Label>
                    <Input
                      id={id("line1")}
                      name={contactField(position, "address_line1")}
                      defaultValue={prefill?.address.line1 ?? ""}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={id("line2")}>Address line 2</Label>
                    <Input
                      id={id("line2")}
                      name={contactField(position, "address_line2")}
                      defaultValue={prefill?.address.line2 ?? ""}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={id("town")}>Town</Label>
                    <Input
                      id={id("town")}
                      name={contactField(position, "address_town")}
                      defaultValue={prefill?.address.town ?? ""}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={id("postcode")}>
                      Postcode {required && <span className="text-destructive">*</span>}
                    </Label>
                    <Input
                      id={id("postcode")}
                      name={contactField(position, "address_postcode")}
                      defaultValue={prefill?.address.postcode ?? ""}
                      required={required}
                      autoComplete="off"
                      className="uppercase"
                    />
                  </div>
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label htmlFor={id("rel")}>
                {leadHere ? `Your relationship to ${personName}` : "Relationship"}
              </Label>
              <Input
                id={id("rel")}
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
