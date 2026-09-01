"use client";

/**
 * The contact-details form on My Profile. Pre-filled from the caller's own
 * `people` row; submits to `update_own_contact()` via the server action. The
 * database's refusals are shown word for word.
 */

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { TownCountyFields } from "@/components/town-county-fields";
import { EmergencyContactsFields } from "@/components/emergency-contacts-fields";
import { EMERGENCY_FIELDS_PRESENT, type EmergencyContact } from "@/lib/emergency-contacts";

import { updateProfile, type ProfileActionState } from "./actions";

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

export function ProfileForm({
  initial,
  emergencyContacts,
  personName,
  showEmergency,
  next,
}: {
  initial: ContactDetails;
  emergencyContacts: EmergencyContact[];
  /** Whose contacts these are, for the fieldset's own wording. */
  personName: string;
  /** Only a player is asked for emergency contacts. */
  showEmergency: boolean;
  /** Where to go after saving — the join wizard sends people here and back. */
  next: string | null;
}) {
  const [state, action, pending] = useActionState<ProfileActionState, FormData>(
    updateProfile,
    {},
  );

  return (
    <form action={action} className="space-y-6">
      {/* Where to go after saving. The join wizard sends people here for the
          one thing it is missing and expects them back (Adam, 2026-09-01). */}
      {next && <input type="hidden" name="next" value={next} />}

      <Card>
        <CardHeader className="p-4 lg:p-6">
          <CardTitle className="text-base">Contact details</CardTitle>
          <p className="text-sm text-muted-foreground">
            These are yours to keep current — the club uses them to reach you.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0">
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

        </CardContent>
      </Card>

      {/* Only a player is asked for these (Adam, 2026-08-26): they are who the
          club rings when something happens to somebody on a pitch. Tick "I am a
          player" above, save, and the card appears. */}
      {showEmergency && (
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Emergency contacts</CardTitle>
            <p className="text-sm text-muted-foreground">
              Who the club rings if something happens to you — an injury at training, or anything
              at a match that means somebody has to be told now. Up to two, and the first is tried
              first. Kept on your record, so they are asked for once rather than on every
              registration form.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            {/* Says the fieldset was on screen, so an absent one is never read
                as "clear them". */}
            <input type="hidden" name={EMERGENCY_FIELDS_PRESENT} value="yes" />
            <EmergencyContactsFields
              idPrefix="profile"
              initial={emergencyContacts}
              lead={null}
              personName={personName}
              requireFirst={false}
            />
          </CardContent>
        </Card>
      )}

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
