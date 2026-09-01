/**
 * The FA's youth football formats by age group — format, match length, pitch
 * size and ball size (design build, 2026-08-25: "Format is read from the age
 * group, not stored per team"). A team's format is never a column: it is
 * derived from `teams.age_group` here, so the end-of-season rollover changes
 * it automatically when the age group moves up.
 *
 * Plain module, no server imports — the teams table and the team page both
 * read it, and a client component may too.
 */

export type FaFormat = {
  /** "U12" … "U18", "Senior". */
  age: string;
  /** "9v9", "11v11", "3v3 (carousel)", "Festival / development". */
  format: string;
  matchLength: string;
  pitchSize: string;
  ball: string;
};

/** Season 2026/27 rules, U6 first. Senior stands for U19 and every adult team. */
export const FA_FORMATS: readonly FaFormat[] = [
  { age: "U6",  format: "Festival / development", matchLength: "10–15 mins per game", pitchSize: "Small festival pitches (cones)", ball: "Size 3" },
  { age: "U7",  format: "3v3 (carousel)", matchLength: "6–10 mins per game",  pitchSize: "15x10m to 20x15m",    ball: "Size 3" },
  { age: "U8",  format: "5v5",   matchLength: "20 mins each way", pitchSize: "27x18m to 37x27m",   ball: "Size 3" },
  { age: "U9",  format: "5v5",   matchLength: "20 mins each way", pitchSize: "27x18m to 37x27m",   ball: "Size 3" },
  { age: "U10", format: "7v7",   matchLength: "25 mins each way", pitchSize: "46x27m to 55x37m",   ball: "Size 3" },
  { age: "U11", format: "7v7",   matchLength: "30 mins each way", pitchSize: "46x27m to 55x37m",   ball: "Size 3" },
  { age: "U12", format: "9v9",   matchLength: "30 mins each way", pitchSize: "64x37m to 73x46m",   ball: "Size 4" },
  { age: "U13", format: "9v9",   matchLength: "35 mins each way", pitchSize: "64x37m to 73x46m",   ball: "Size 4" },
  { age: "U14", format: "11v11", matchLength: "35 mins each way", pitchSize: "82x46m to 91x55m",   ball: "Size 5" },
  { age: "U15", format: "11v11", matchLength: "40 mins each way", pitchSize: "82x46m to 100x64m",  ball: "Size 5" },
  { age: "U16", format: "11v11", matchLength: "40 mins each way", pitchSize: "82x46m to 100x64m",  ball: "Size 5" },
  { age: "U17", format: "11v11", matchLength: "45 mins each way", pitchSize: "100x64m (full-size)", ball: "Size 5" },
  { age: "U18", format: "11v11", matchLength: "45 mins each way", pitchSize: "100x64m (full-size)", ball: "Size 5" },
  { age: "Senior", format: "11v11", matchLength: "45 mins each way", pitchSize: "100x64m (full-size)", ball: "Size 5" },
];

const byAge = new Map(FA_FORMATS.map((row) => [row.age, row]));

/**
 * The rules an age-group string falls under, or null when it names no FA age
 * (blank, or another sport). "U05"/"U5" and a range like "U05–U08" read from
 * the first number (younger than U6 gets U6's festival rules); "Open Age",
 * "Senior", "Vets", "Adult" and U19+ are all Senior.
 */
export function faFormatFor(ageGroup: string | null | undefined): FaFormat | null {
  if (!ageGroup) return null;
  const trimmed = ageGroup.trim();
  const digits = trimmed.match(/\d+/);
  if (digits) {
    const age = Number(digits[0]);
    if (age <= 6) return byAge.get("U6") ?? null;
    if (age >= 19) return byAge.get("Senior") ?? null;
    return byAge.get(`U${age}`) ?? null;
  }
  if (/open|senior|vet|adult|ladies|men|women/i.test(trimmed)) return byAge.get("Senior") ?? null;
  return null;
}

/** "30 mins each way · size 4" — the muted second line under a format. */
export function faFormatDetail(rules: FaFormat): string {
  return `${rules.matchLength} · ${rules.ball.toLocaleLowerCase("en-GB")}`;
}
