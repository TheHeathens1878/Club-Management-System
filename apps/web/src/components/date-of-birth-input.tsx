"use client";

/**
 * One date-of-birth field, everywhere the club asks for one.
 *
 * It is a plain `<input type="date">` with three things the bare element does
 * not give you: bounds that shorten iOS's year wheel to a hundred-odd entries
 * instead of thousands, a starting point that is near an adult's answer rather
 * than on today, and a line that says the starting point is only that — see
 * `lib/date-of-birth.ts` for why each one is there.
 *
 * It holds no opinion about who the person is. `start` is the caller's answer
 * to "is this field about an adult", because only the caller knows: the same
 * component fills in a parent on one step of the joining wizard and their
 * child on the next.
 *
 * Controlled or uncontrolled, because both exist in this codebase. Pass
 * `value` + `onValueChange` and the caller owns it — and a caller doing that
 * with `start="adult"` must seed its own state with `ADULT_DOB_DEFAULT`, since
 * a controlled input shows what it is given and nothing else.
 */

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { ADULT_DOB_DEFAULT, DOB_DEFAULT_HINT, EARLIEST_DOB } from "@/lib/date-of-birth";
import { todayIso } from "@/lib/people-display";

export type DateOfBirthInputProps = {
  id: string;
  /** The posted field name. Every server action in this app reads `dob`. */
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /**
   * `"adult"` opens the picker on 1 January 1990; `"blank"` leaves the field
   * empty, which is right for a child (today is already near their birth year)
   * and for an admin form that could be about either.
   */
  start?: "adult" | "blank";
  /** Controlled value. Omit for an uncontrolled field. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Uncontrolled starting value — a record being edited wins over `start`. */
  defaultValue?: string;
};

export function DateOfBirthInput({
  id,
  name = "dob",
  required,
  disabled,
  className,
  start = "blank",
  value,
  onValueChange,
  defaultValue,
}: DateOfBirthInputProps) {
  const seeded = start === "adult" ? ADULT_DOB_DEFAULT : "";
  const initial = defaultValue ?? seeded;
  const controlled = value !== undefined;

  // Tracked only to decide whether the hint below is still true. An
  // uncontrolled input is otherwise left entirely to the browser.
  const [typed, setTyped] = useState(initial);
  const current = controlled ? value : typed;

  return (
    <>
      <Input
        id={id}
        name={name}
        type="date"
        required={required}
        disabled={disabled}
        className={className}
        min={EARLIEST_DOB}
        max={todayIso()}
        {...(controlled ? { value } : { defaultValue: initial })}
        onChange={(event) => {
          if (!controlled) setTyped(event.target.value);
          onValueChange?.(event.target.value);
        }}
      />
      {current === ADULT_DOB_DEFAULT && (
        <p className="text-xs text-muted-foreground">{DOB_DEFAULT_HINT}</p>
      )}
    </>
  );
}
