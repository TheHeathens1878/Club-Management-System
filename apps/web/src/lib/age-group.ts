/**
 * The order a club reads its age groups in: "Under 7s" up through "Under 18s"
 * by the number, then the named grown-up groups ("Open age", "Vets")
 * alphabetically, then teams with no age group at all. Plain alphabetical
 * sorting gets this wrong ("U10" before "U7"), which is why the key pads the
 * digits.
 *
 * Lifted from the teams page so the matches desk can order by the same rule
 * (Adam, 2026-09-04: "the ability to order by Age group from U07 up to Vets").
 */
export function ageGroupKey(ageGroup: string | null): [number, string] {
  if (!ageGroup) return [3, ""];
  const digits = ageGroup.match(/\d+/);
  if (digits) return [1, digits[0].padStart(4, "0")];
  return [2, ageGroup.toLocaleLowerCase("en-GB")];
}

/** U7 < U8 < … < U18 < Open age < Vets < no age group. */
export function compareAgeGroups(a: string | null, b: string | null): number {
  const [aRank, aKey] = ageGroupKey(a);
  const [bRank, bKey] = ageGroupKey(b);
  if (aRank !== bRank) return aRank - bRank;
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}
