/**
 * Where a date-of-birth picker should open.
 *
 * Adam, 2026-09-01, from an iPhone: "the date picker for DOB is a spinny wheel
 * on iOS. Please can you make the default to be 01/01/1990 and have the day on
 * the spinny wheel."
 *
 * An empty `<input type="date">` opens its wheel on TODAY. For a date of birth
 * that is the one date it can never be, and an adult signing up in 2026 has to
 * spin the year column back three or four decades to reach their own. The
 * default below puts the wheel where an adult's answer actually lives, so most
 * people move it by a few years rather than by forty.
 *
 * The bounds matter as much as the default. Without `min` and `max` the year
 * column runs to thousands of entries; with them it is the hundred-odd years a
 * person could plausibly have been born in, which is a far shorter spin.
 *
 * WHY THIS IS NOT DONE FOR A CHILD. The same default would be actively wrong
 * on the "add a child" forms — a child born in 1990 is thirty-six, `add_child()`
 * refuses them outright, and the picker would open FURTHER from the answer
 * than today's date does. Those fields stay blank; today is already close to a
 * child's birth year. See `DateOfBirthInput`'s `start` prop.
 */

/** Where an adult's picker opens. Not a guess at their age — a starting point. */
export const ADULT_DOB_DEFAULT = "1990-01-01";

/** The floor of the year column. Nobody in the club's records was born before it. */
export const EARLIEST_DOB = "1900-01-01";

/**
 * The line shown while a pre-filled field is still sitting on the default.
 *
 * A pre-filled date can be submitted without being read, and a date of birth
 * decides age group, FA band and — everywhere SG-0 reaches — whether somebody
 * is treated as a child. So the field says out loud that the date in it is
 * scaffolding, and stops saying it the moment the reader changes it.
 */
export const DOB_DEFAULT_HINT =
  "Change this to the real date of birth — 1 January 1990 is only where the picker starts.";
