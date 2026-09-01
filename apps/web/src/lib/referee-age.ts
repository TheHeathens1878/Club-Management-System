/**
 * When somebody may put their hand up to referee.
 *
 * The rule is the FA's and the club follows it: referees are registered from
 * 14 (Adam, 2026-09-01). It is ENFORCED by `person_roles_referee_age_guard()`
 * and `account_requests_referee_age_guard()` (20260901160000) — a trigger on
 * the role itself, so every path meets the same rule. Nothing in this file
 * enforces anything; it exists so a form can decline to offer a tick that the
 * database is going to refuse, and say when it will stop refusing.
 *
 * The age is a documented safeguarding setting, so it is passed in rather than
 * written down: the caller reads it with
 * `safeguarding_setting_int('safeguarding.min_referee_age')` and the constant
 * below is only the fallback that function itself documents.
 */

/** The documented default of `safeguarding.min_referee_age`. */
export const DEFAULT_MIN_REFEREE_AGE = 14;

/** The date somebody born on `dob` turns `age`. Null if the date is unusable. */
export function birthdayFor(dob: string, age: number): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const born = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  // UTC throughout: a date of birth is a date, and shifting it into a local
  // zone is how a birthday lands on the wrong day for half the country.
  return new Date(Date.UTC(born.getUTCFullYear() + age, born.getUTCMonth(), born.getUTCDate()));
}

/**
 * Is this person old enough to referee today?
 *
 * An unknown or unparseable date of birth is FALSE, which is SG-0's rule
 * everywhere else in this schema: unknown counts as too young, and the
 * database refuses it for the same reason.
 */
export function oldEnoughToReferee(dob: string | null, minAge: number): boolean {
  if (!dob) return false;
  const birthday = birthdayFor(dob, minAge);
  if (!birthday) return false;
  return birthday.getTime() <= Date.now();
}

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * The sentence to show beside a tick that cannot be ticked yet — the same
 * shape the database's own refusal uses, so the two never read as two
 * different rules.
 */
export function refereeFromSentence(dob: string | null, minAge: number, who: string): string {
  const birthday = dob ? birthdayFor(dob, minAge) : null;
  if (!birthday) {
    return `The club registers referees from ${minAge}, and needs a date of birth before it can tell.`;
  }
  return `The club registers referees from ${minAge} — ${who} can ask from ${LONG_DATE.format(birthday)}.`;
}
