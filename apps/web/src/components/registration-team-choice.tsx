"use client";

/**
 * The team a player is being registered into — the one picker, shared by the
 * /join wizard's player panel and the family screen's "Register for a team".
 *
 * Adam, 2026-08-26:
 *   "When registering a player, limit the teams they can choose to their own
 *    age group (be careful not to fall foul of UTC issues) and the age group
 *    above."
 *   "Males cannot join female teams but females can join males."
 *
 * Both rules are applied here to decide what is OFFERED, and both are re-asked
 * by the database when the registration is written — `registrations_guard()`
 * refuses a male player a girls' team outright, and refuses a non-administrator
 * a team outside the two bands. This component is the courtesy; the trigger is
 * the rule.
 *
 * The age band is computed from the date of birth STRING, never a Date. See
 * `lib/waiting-list.ts` for why: `new Date("2014-09-01")` is midnight UTC,
 * which is 31 August west of Greenwich, and 31 August / 1 September is exactly
 * the line the FA cohort turns on.
 *
 * A club administrator — and nobody else — gets "show all teams". A coach or a
 * parent gets the two bands, and a player whose date of birth the club does
 * not hold gets nothing at all with a sentence saying why (SG-0 treats an
 * unknown date of birth as a minor, and the club cannot place a child it
 * cannot age).
 */

import { useMemo, useState } from "react";

import { Label } from "@/components/ui/input";
import {
  eligibleBandsLabel,
  normalisePlayerSex,
  teamOfferedToPlayer,
  type PlayerSex,
} from "@/lib/waiting-list";

export type TeamChoiceOption = {
  id: string;
  name: string;
  ageGroup: string | null;
  /** null | "mixed" | "boys" | "girls" — `teams.gender`. */
  gender?: string | null;
};

const SELECT_CLASS =
  "block h-11 w-full rounded-md border bg-background px-3 text-sm lg:h-10";

export function TeamChoiceFields({
  idPrefix,
  teamFieldName,
  teams,
  dob,
  recordedSex,
  isAdmin,
  firstName,
  extraOption,
  helpText,
}: {
  idPrefix: string;
  /** "team_choice" in the wizard, "team_id" on the family screen. */
  teamFieldName: string;
  teams: readonly TeamChoiceOption[];
  /** yyyy-mm-dd, or null when the club does not hold one. */
  dob: string | null;
  /** What `people.sex` already says, so the form does not re-ask blindly. */
  recordedSex: string | null;
  isAdmin: boolean;
  firstName: string;
  /** The wizard's "No team yet" line, which is not a team. */
  extraOption?: { value: string; label: string };
  helpText?: string;
}) {
  const [sex, setSex] = useState<PlayerSex | "">(normalisePlayerSex(recordedSex) ?? "");
  const [showAll, setShowAll] = useState(false);

  const offered = useMemo(() => {
    if (isAdmin && showAll) return teams;
    return teams.filter((team) => teamOfferedToPlayer(team, dob, sex === "" ? null : sex));
  }, [dob, isAdmin, sex, showAll, teams]);

  const bands = eligibleBandsLabel(dob);
  const dobKnown = bands !== null;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Team</legend>

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-sex`}>
          Sex <span className="text-destructive">*</span>
        </Label>
        <select
          id={`${idPrefix}-sex`}
          name="biological_sex"
          required
          value={sex}
          onChange={(event) => setSex(normalisePlayerSex(event.target.value) ?? "")}
          className={SELECT_CLASS + " sm:w-64"}
        >
          <option value="">Choose…</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <p className="text-xs text-muted-foreground">
          The league needs this to place {firstName} in an age group. A girls&rsquo; team is for
          female players; a boys&rsquo; or mixed team is open to everyone.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-team`}>
          Which team? <span className="text-destructive">*</span>
        </Label>
        <select
          id={`${idPrefix}-team`}
          name={teamFieldName}
          required
          defaultValue=""
          className={SELECT_CLASS}
        >
          <option value="" disabled>
            {sex === "" && dobKnown ? "Choose a sex first…" : "Choose a team…"}
          </option>
          {offered.map((team) => (
            <option key={team.id} value={team.id}>
              {team.ageGroup ? `${team.ageGroup} — ` : ""}
              {team.name}
            </option>
          ))}
          {extraOption && <option value={extraOption.value}>{extraOption.label}</option>}
        </select>

        {!dobKnown ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            The club does not hold a date of birth for {firstName}, so there is no age group to
            offer a team from — and until it knows, the club has to treat them as a child it
            cannot place. Ask a club administrator to add it to their record.
          </p>
        ) : offered.length === 0 && !extraOption ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {sex === ""
              ? `Choose whether ${firstName} is male or female and the teams for their age group will appear.`
              : `The club is not running a team ${firstName} is eligible for (${bands}). Ask a club administrator.`}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {helpText ??
              `Only ${bands} is offered — a player plays in their own age group or the one above it.`}
          </p>
        )}

        {/* The escape hatch is a club administrator's, and only theirs. A coach
            or a parent asking for a team outside the two bands is refused by
            `registrations_guard()` anyway, so offering it would be a lie. */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAll((current) => !current)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {showAll ? "Show only their age group" : "Show all teams (club administrator)"}
          </button>
        )}
      </div>
    </fieldset>
  );
}
