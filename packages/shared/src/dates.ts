export const ADULT_AGE = 18;

/**
 * Age in whole years at `on` (default: now).
 * Mirrors the DB derivation planned for `people.is_minor` (P1.1) so UI and DB agree.
 */
export function ageInYears(dateOfBirth: Date, on: Date = new Date()): number {
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (on.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      on.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function isMinor(dateOfBirth: Date, on: Date = new Date()): boolean {
  return ageInYears(dateOfBirth, on) < ADULT_AGE;
}
