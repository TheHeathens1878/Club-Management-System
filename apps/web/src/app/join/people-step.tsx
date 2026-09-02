"use client";

/**
 * Steps 2 and 3 of joining — your children, then your connected adults.
 *
 * One component for both, because they are the same act with two different
 * doors behind them: `add_child()` records a guardianship, and
 * `add_household_adult()` looks for somebody the club already knows. Which one
 * runs is the DATE OF BIRTH's decision and the server action's; this screen
 * only says which step asked, so that a date on the wrong step is answered
 * with "they go on the next step" instead of a safeguarding refusal that reads
 * like a fault.
 *
 * THE NO-CHILDREN TICK (Adam, 2026-09-01). The children step will not let you
 * past until you have either added somebody or said there is nobody — and the
 * connected-adults step will. That asymmetry is deliberate: children are what
 * most of this club is for, and a parent who scrolls past their own child has
 * made an expensive mistake quietly. An adult nobody adds is simply an adult
 * nobody added.
 */

import { useEffect, useState } from "react";
import { Check, ChevronLeft, UserPlus, Users } from "lucide-react";

import { DateOfBirthInput } from "@/components/date-of-birth-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { ADULT_DOB_DEFAULT } from "@/lib/date-of-birth";
import { oldEnoughToReferee, refereeFromSentence } from "@/lib/referee-age";

import { MAX_HOUSEHOLD } from "./constants";
import type { RoleAsk } from "./actions";

export type HouseholdPerson = {
  personId: string;
  firstName: string;
  lastName: string;
  dob: string;
  playing: boolean;
  minor: boolean;
  isSelf: boolean;
  needsId: boolean;
  /** `people.sex` if the club already holds it, so the form defaults to it. */
  sex: string | null;
};

export type PeopleStepKind = "child" | "adult";

const COPY: Record<
  PeopleStepKind,
  { title: string; blurb: string; addTitle: string; empty: string; playing: string }
> = {
  child: {
    title: "Your children",
    blurb:
      "Add each child this membership covers. The club records you as their guardian, which is what lets you register them, answer for them and see their details.",
    addTitle: "Add a child",
    empty: "No children added yet.",
    playing: "They will be playing",
  },
  adult: {
    title: "Connected adults",
    blurb:
      "An adult player in the club whose membership sits with yours. They can have their own login; the membership is paid by this account. Somebody who already has an account of their own registers themselves — the club connects you afterwards.",
    addTitle: "Add a connected adult",
    empty: "No connected adults added yet.",
    playing: "They will be playing",
  },
};

export function PeopleStep({
  kind,
  people,
  householdCount,
  minRefereeAge,
  pending,
  error,
  confirm,
  roles,
  noneTicked,
  onNoneChange,
  onAdd,
  onConfirmAnyway,
  onBack,
  onContinue,
}: {
  kind: PeopleStepKind;
  /** The people of this kind added so far. */
  people: HouseholdPerson[];
  /** Everybody on the membership, the registrant included — the cap is on this. */
  householdCount: number;
  minRefereeAge: number;
  pending: boolean;
  error: string | null;
  /** A possible duplicate the club already holds: the sentence, and the retry. */
  confirm: { message: string } | null;
  roles: RoleAsk | null;
  /** Children only: "I have no children to add". */
  noneTicked: boolean;
  onNoneChange: (value: boolean) => void;
  onAdd: (formData: FormData) => void;
  onConfirmAnyway: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const copy = COPY[kind];
  // Where this step's picker opens. A connected adult gets 1 January 1990 so
  // the iOS wheel starts near a grown-up's answer; a child gets nothing,
  // because 1990 would open the wheel FURTHER from a child's birth year than
  // today does, and `add_child()` refuses a thirty-six-year-old anyway.
  const startingDob = kind === "adult" ? ADULT_DOB_DEFAULT : "";
  const [dob, setDob] = useState(startingDob);

  // React clears an uncontrolled form after a successful action, but the date
  // of birth is CONTROLLED here (the referee tick depends on it), so it would
  // survive into the next person — a second child inheriting the first one's
  // birthday, with every other field blank. Put it back to this step's
  // starting point whenever somebody has been added.
  useEffect(() => {
    setDob(startingDob);
  }, [people.length, startingDob]);

  const full = householdCount >= MAX_HOUSEHOLD;
  const refereeAllowed = oldEnoughToReferee(dob || null, minRefereeAge);
  const canContinue = kind === "adult" || people.length > 0 || noneTicked;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" /> {copy.title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{copy.blurb}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.empty}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {people.map((person) => (
              <li key={person.personId} className="flex flex-wrap items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" />
                {person.firstName} {person.lastName}
                {person.playing && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs">playing</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* What the ticks beside the last person asked for. "Asked", never
            "granted": a club administrator decides every one of these in
            /approvals, and saying otherwise here would be a promise this
            screen cannot keep. */}
        {roles && roles.asked.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {roles.asked.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        )}
        {roles && roles.refused.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {roles.refused.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        )}

        {full ? (
          <p className="text-sm text-muted-foreground">
            That is the maximum of {MAX_HOUSEHOLD} people for one membership.
          </p>
        ) : (
          <form
            action={(formData) => {
              formData.set("step", kind);
              onAdd(formData);
            }}
            className="space-y-3 rounded-lg border p-3"
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <UserPlus className="h-4 w-4" /> {copy.addTitle}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input name="first_name" placeholder="First name" required />
              <Input name="last_name" placeholder="Surname" required />
              <div className="space-y-1">
                <Label htmlFor={`add-${kind}-dob`}>Date of birth</Label>
                <DateOfBirthInput
                  id={`add-${kind}-dob`}
                  required
                  start={kind === "adult" ? "adult" : "blank"}
                  value={dob}
                  onValueChange={setDob}
                />
              </div>
              {kind === "adult" && (
                <div className="space-y-1">
                  <Label htmlFor="add-adult-email">Email (optional)</Label>
                  <Input id="add-adult-email" name="email" type="email" />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="playing" value="yes" defaultChecked className="h-4 w-4" />
                {copy.playing}
              </label>

              {kind === "adult" && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="coaching" value="yes" className="mt-0.5 h-4 w-4" />
                  <span>
                    They coach, or would like to
                    <span className="block text-xs text-muted-foreground">
                      A club administrator confirms it and puts them with a team.
                    </span>
                  </span>
                </label>
              )}

              {/* The referee tick, on children as well as on adults (Adam,
                  2026-09-01). Always shown, and tickable only once the date of
                  birth says it can be honoured: offering a tick the database
                  will refuse is how a form teaches somebody that it lies, and
                  hiding it altogether is how a parent never learns their
                  fourteen-year-old could referee. Disabled, with the reason. */}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="refereeing"
                  value="yes"
                  disabled={!refereeAllowed}
                  className="mt-0.5 h-4 w-4 disabled:opacity-50"
                />
                <span className={refereeAllowed ? undefined : "text-muted-foreground"}>
                  They referee, or would like to
                  <span className="block text-xs text-muted-foreground">
                    {refereeAllowed
                      ? "Puts them in the club’s referees group once an administrator confirms it, where games needing a referee are posted."
                      : dob === ""
                        ? `Fill in their date of birth first — the club registers referees from ${minRefereeAge}.`
                        : refereeFromSentence(dob, minRefereeAge, "they")}
                  </span>
                </span>
              </label>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {confirm && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-sm text-amber-900">{confirm.message}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={onConfirmAnyway}
                >
                  This is a different person — add them anyway
                </Button>
              </div>
            )}
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
          </form>
        )}

        {kind === "child" && (
          <label className="flex items-start gap-2 rounded-lg border bg-secondary/30 p-3 text-sm">
            <input
              type="checkbox"
              checked={noneTicked}
              onChange={(event) => onNoneChange(event.target.checked)}
              disabled={people.length > 0}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              I have no children to add
              <span className="block text-xs text-muted-foreground">
                {people.length > 0
                  ? "You have already added a child, so this no longer applies."
                  : "Tick this to carry on. You can add a child later from Children & family."}
              </span>
            </span>
          </label>
        )}

        <div className="flex justify-between">
          <Button variant="ghost" size="sm" onClick={onBack} disabled={pending}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <Button onClick={onContinue} disabled={pending || !canContinue}>
            {canContinue ? "Continue" : "Add a child, or say there are none"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
