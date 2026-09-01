"use client";

/**
 * The contact-details form on My Profile. Pre-filled from the caller's own
 * `people` row; submits to `update_own_contact()` via the server action. The
 * database's refusals are shown word for word.
 */

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { TownCountyFields } from "@/components/town-county-fields";
import { EmergencyContactsFields } from "@/components/emergency-contacts-fields";
import type { EmergencyContact } from "@/lib/emergency-contacts";

import { updateContactDetails, updateEmergencyContacts, type ProfileActionState } from "./actions";

export type ContactDetails = {
  preferredName: string;
  phone: string;
  /** Adam, 2026-08-26: their own statement that they play for the club. */
  isPlayer: boolean;
  line1: string;
  line2: string;
  town: string;
  /** Settled by the town where the club knows it (see lib/address). */
  county: string;
  postcode: string;
};

export function ContactDetailsForm({ initial }: { initial: ContactDetails }) {
  const [state, action, pending] = useActionState<ProfileActionState, FormData>(
    updateContactDetails,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="preferred-name">Known as</Label>
          <Input
            id="preferred-name"
            name="preferred_name"
            defaultValue={initial.preferredName}
            placeholder="The name people use for you"
            autoComplete="nickname"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={initial.phone}
            autoComplete="tel"
          />
        </div>
      </div>

      {/* Adam, 2026-08-26: "there should be a tick box on My Profile saying I
          am a player". It decides which questions the club asks you — the
          emergency contacts below, and whether you are offered on Register a
          player — and nothing else. */}
      <label className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
        <input
          type="checkbox"
          name="is_player"
          value="yes"
          defaultChecked={initial.isPlayer}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span>
          I am a player
          <span className="block text-xs text-muted-foreground">
            Tick this if you play for the club yourself. It is what puts you on Register a player
            and what makes the club ask you for an emergency contact.
          </span>
        </span>
      </label>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Home address</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="address-line1">Address line 1</Label>
            <Input
              id="address-line1"
              name="address_line1"
              defaultValue={initial.line1}
              autoComplete="address-line1"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="address-line2">Address line 2 (optional)</Label>
            <Input
              id="address-line2"
              name="address_line2"
              defaultValue={initial.line2}
              autoComplete="address-line2"
            />
          </div>
          <TownCountyFields
            idPrefix="profile-address"
            defaultTown={initial.town}
            defaultCounty={initial.county}
          />
          <div className="space-y-1">
            <Label htmlFor="address-postcode">Postcode</Label>
            <Input
              id="address-postcode"
              name="address_postcode"
              defaultValue={initial.postcode}
              autoComplete="postal-code"
            />
          </div>
        </div>
      </fieldset>

      {state.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.notice}
        </p>
      )}

      <Button
        type="submit"
        size="sm"
        disabled={pending}
        className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
      >
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

/**
 * The caller's own emergency contacts (Adam, 2026-08-25). Nobody is "the lead
 * contact" for themselves, so the tick-box is not offered; contact 1 is
 * optional here — the registration is what insists on one.
 */
export function OwnEmergencyContactsForm({
  initial,
  personName,
}: {
  initial: EmergencyContact[];
  personName: string;
}) {
  const [state, action, pending] = useActionState<ProfileActionState, FormData>(
    updateEmergencyContacts,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      <EmergencyContactsFields
        idPrefix="profile"
        initial={initial}
        lead={null}
        personName={personName}
        requireFirst={false}
      />

      {state.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.notice}
        </p>
      )}

      <Button
        type="submit"
        size="sm"
        disabled={pending}
        className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
      >
        {pending ? "Saving…" : "Save contacts"}
      </Button>
    </form>
  );
}
