"use client";

/**
 * What the public sees about this team (gap 10).
 *
 * Everything on this form is published on /recruitment the moment
 * "recruiting" is on — including the contact details, but only if the second
 * switch is on as well. Both are shown as plain checkboxes with the
 * consequence written next to them rather than as a toggle whose effect you
 * have to remember.
 */

import { useActionState } from "react";
import { Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/field";

import { updateTeamRecruiting, type RecruitingState } from "./recruiting-actions";

export type RecruitingValues = {
  recruiting: boolean;
  gender: string | null;
  join_type: string | null;
  join_instructions: string | null;
  session_details: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  show_coach_contact: boolean;
};

export function RecruitingPanel({
  teamId,
  values,
  canEdit,
}: {
  teamId: string;
  values: RecruitingValues;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<RecruitingState, FormData>(
    updateTeamRecruiting,
    {},
  );

  if (!canEdit) {
    return (
      <p className="text-sm text-muted-foreground">
        {values.recruiting
          ? "This team is listed on the club's public recruitment page."
          : "This team is not listed on the club's public recruitment page."}
      </p>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="team_id" value={teamId} />

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-secondary/40 px-3 py-2 text-sm">
        <input
          type="checkbox"
          name="recruiting"
          value="yes"
          defaultChecked={values.recruiting}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span>
          <span className="font-medium">List this team on the public recruitment page.</span>
          <span className="block text-xs text-muted-foreground">
            Anyone on the internet can read what is on this form while it is ticked.
          </span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`gender-${teamId}`}>Team make-up</Label>
          <Select id={`gender-${teamId}`} name="gender" defaultValue={values.gender ?? ""}>
            <option value="">Not stated</option>
            <option value="mixed">Mixed</option>
            <option value="boys">Boys</option>
            <option value="girls">Girls</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`join-type-${teamId}`}>How to join</Label>
          <Select id={`join-type-${teamId}`} name="join_type" defaultValue={values.join_type ?? ""}>
            <option value="">Not stated</option>
            <option value="open">Open — come along to a session</option>
            <option value="waiting_list">Waiting list</option>
            <option value="trial">Trial first</option>
            <option value="closed">Not taking players right now</option>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`session-details-${teamId}`}>Training and match times</Label>
        <Textarea
          id={`session-details-${teamId}`}
          name="session_details"
          rows={2}
          defaultValue={values.session_details ?? ""}
          placeholder="Tuesdays 6–7pm at the club, matches Sunday mornings"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`join-instructions-${teamId}`}>What a new player should do</Label>
        <Textarea
          id={`join-instructions-${teamId}`}
          name="join_instructions"
          rows={2}
          defaultValue={values.join_instructions ?? ""}
          placeholder="Turn up ten minutes early with shin pads and a drink — no need to book."
        />
      </div>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-semibold">Contact</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`contact-name-${teamId}`}>Name</Label>
            <Input
              id={`contact-name-${teamId}`}
              name="contact_name"
              defaultValue={values.contact_name ?? ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`contact-email-${teamId}`}>Email</Label>
            <Input
              id={`contact-email-${teamId}`}
              name="contact_email"
              type="email"
              defaultValue={values.contact_email ?? ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`contact-phone-${teamId}`}>Phone</Label>
            <Input
              id={`contact-phone-${teamId}`}
              name="contact_phone"
              type="tel"
              defaultValue={values.contact_phone ?? ""}
            />
          </div>
        </div>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="show_coach_contact"
            value="yes"
            defaultChecked={values.show_coach_contact}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            Show these contact details publicly.
            <span className="block text-xs text-muted-foreground">
              Leave this off and the public page shows the team without them; the club&apos;s own
              address is used instead. Never put a child&apos;s details here.
            </span>
          </span>
        </label>
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

      <Button type="submit" size="sm" disabled={pending}>
        <Megaphone className="h-4 w-4" />
        {pending ? "Saving…" : "Save recruiting details"}
      </Button>
    </form>
  );
}
