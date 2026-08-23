"use client";

import { useActionState, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/field";
import { SCHOOL_LIST } from "@/lib/schools";
import {
  AGE_GROUP_TO_SCHOOL_YEAR,
  SCHOOL_YEARS,
  SCHOOL_YEAR_TO_AGE_GROUP,
  ageGroupFromDob,
} from "@/lib/waiting-list";

import { submitWaitingListEntry, type SubmitState } from "./actions";

/**
 * The public form. Date of birth, school year and age group stay in step with
 * each other the way they did on the pitch-booking site, but only age groups
 * the club has actually opened are offered — and the database refuses a closed
 * one regardless of what is posted.
 */
export function WaitingListForm({ openAgeGroups }: { openAgeGroups: string[] }) {
  const open = new Set(openAgeGroups);

  const [ageGroup, setAgeGroup] = useState("");
  const [schoolYear, setSchoolYear] = useState("");
  const [biologicalSex, setBiologicalSex] = useState("");
  const [school, setSchool] = useState("");
  const [coachingInterest, setCoachingInterest] = useState(false);

  const [state, action, pending] = useActionState<SubmitState, FormData>(submitWaitingListEntry, {});

  if (state.ok) {
    return (
      <div className="py-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
        <h2 className="mt-4 text-lg font-semibold">Thank you — you&apos;re on the list</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          We have your details and have passed them to the coaches for that age group. We will be in
          touch when a space becomes available. There is nothing else you need to do.
        </p>
      </div>
    );
  }

  function handleDobChange(event: React.ChangeEvent<HTMLInputElement>) {
    const date = new Date(event.target.value);
    if (Number.isNaN(date.getTime())) return;
    const suggested = ageGroupFromDob(date);
    setSchoolYear(AGE_GROUP_TO_SCHOOL_YEAR[suggested] ?? "");
    if (open.has(suggested)) setAgeGroup(suggested);
  }

  function handleSchoolYearChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const year = event.target.value;
    setSchoolYear(year);
    const suggested = SCHOOL_YEAR_TO_AGE_GROUP[year];
    if (suggested && open.has(suggested)) setAgeGroup(suggested);
  }

  function handleAgeGroupChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const group = event.target.value;
    setAgeGroup(group);
    const year = AGE_GROUP_TO_SCHOOL_YEAR[group];
    if (year) setSchoolYear(year);
  }

  return (
    <form action={action} className="space-y-8">
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold uppercase tracking-wide text-primary">
          Player details
        </legend>

        <div className="space-y-1">
          <Label htmlFor="player_name">
            Player&apos;s full name <span className="text-destructive">*</span>
          </Label>
          <Input id="player_name" name="player_name" placeholder="First and last name" required />
        </div>

        <div className="space-y-1">
          <Label htmlFor="dob">
            Date of birth <span className="text-destructive">*</span>
          </Label>
          <Input id="dob" name="dob" type="date" required onChange={handleDobChange} />
          <p className="text-xs text-muted-foreground">
            We use this to work out the right age group — you can change it below.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="school_year">
              School year <span className="text-destructive">*</span>
            </Label>
            <Select
              id="school_year"
              name="school_year"
              required
              value={schoolYear}
              onChange={handleSchoolYearChange}
            >
              <option value="">Select school year</option>
              {SCHOOL_YEARS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="age_group">
              Age group <span className="text-destructive">*</span>
            </Label>
            <Select
              id="age_group"
              name="age_group"
              required
              value={ageGroup}
              onChange={handleAgeGroupChange}
            >
              <option value="">Select age group</option>
              {openAgeGroups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {schoolYear && SCHOOL_YEAR_TO_AGE_GROUP[schoolYear] && !open.has(SCHOOL_YEAR_TO_AGE_GROUP[schoolYear]) && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            We are not currently running a waiting list for{" "}
            {SCHOOL_YEAR_TO_AGE_GROUP[schoolYear]}. You are welcome to put your child down for one of
            the age groups above, or check back later.
          </p>
        )}

        <div className="space-y-1">
          <Label htmlFor="biological_sex">
            Biological sex <span className="text-destructive">*</span>
          </Label>
          <Select
            id="biological_sex"
            name="biological_sex"
            required
            value={biologicalSex}
            onChange={(event) => setBiologicalSex(event.target.value)}
          >
            <option value="">Select</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </Select>
        </div>

        {biologicalSex === "FEMALE" && (
          <div className="space-y-1">
            <Label htmlFor="team_preference">
              Team preference <span className="text-destructive">*</span>
            </Label>
            <Select id="team_preference" name="team_preference" required defaultValue="">
              <option value="">Select preference</option>
              <option value="MIXED">Happy to play in a mixed team</option>
              <option value="GIRLS_ONLY">Girls only team preferred</option>
            </Select>
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="school">School</Label>
          <Select
            id="school"
            name="school"
            value={school}
            onChange={(event) => setSchool(event.target.value)}
          >
            <option value="">Select school (optional)</option>
            {SCHOOL_LIST.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value="Other">Other</option>
          </Select>
          {school === "Other" && (
            <Input
              name="school_other"
              placeholder="Please enter the school name"
              className="mt-2"
              aria-label="School name"
            />
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="health_conditions">
            Does the player have any health conditions we need to know about?
          </Label>
          <Textarea
            id="health_conditions"
            name="health_conditions"
            rows={3}
            placeholder="e.g. asthma, allergies, diabetes — or leave blank if none"
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold uppercase tracking-wide text-primary">
          Parent or guardian
        </legend>

        <div className="space-y-1">
          <Label htmlFor="parent_name">
            Full name <span className="text-destructive">*</span>
          </Label>
          <Input id="parent_name" name="parent_name" placeholder="Parent or guardian name" required />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="parent_email">
              Email address <span className="text-destructive">*</span>
            </Label>
            <Input
              id="parent_email"
              name="parent_email"
              type="email"
              placeholder="email@example.com"
              required
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="parent_phone">
              Phone number <span className="text-destructive">*</span>
            </Label>
            <Input id="parent_phone" name="parent_phone" type="tel" placeholder="07xxx xxxxxx" required />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-semibold text-primary">Coaching</legend>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="coaching_interest"
            value="yes"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={coachingInterest}
            onChange={(event) => setCoachingInterest(event.target.checked)}
          />
          <span className="text-sm">
            I, or someone I know, would be prepared to help coach a team — which would help us start
            one for this age group.
          </span>
        </label>
        {coachingInterest && (
          <div className="space-y-1">
            <Label htmlFor="coaching_note" className="text-muted-foreground">
              Tell us a bit more (optional)
            </Label>
            <Textarea
              id="coaching_note"
              name="coaching_note"
              rows={3}
              placeholder="Any relevant experience, availability, and so on."
            />
          </div>
        )}
      </fieldset>

      <div className="rounded-lg border bg-secondary/40 p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="data_consent"
            value="yes"
            required
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="text-sm">
            <span className="font-medium">I agree</span> that the details on this form may be shared
            with the relevant age group coaches at the club for the purpose of managing the waiting
            list. <span className="text-destructive">*</span>
          </span>
        </label>
      </div>

      {state.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Submitting…" : "Join the waiting list"}
      </Button>
    </form>
  );
}
