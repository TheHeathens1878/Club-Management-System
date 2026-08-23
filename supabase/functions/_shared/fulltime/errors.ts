/**
 * Thrown by {@link parseFullTimeUrl} when a string is not a Full-Time URL we
 * can get identifiers out of.
 *
 * P2.3 puts this string in front of a club admin who has just pasted a link
 * into a team settings screen, so `message` is written for them, not for a
 * log file.
 */
export class FullTimeUrlError extends Error {
  /** The input, so a caller can echo it back in a form error. */
  readonly input: string;

  constructor(message: string, input: string) {
    super(message);
    this.name = "FullTimeUrlError";
    this.input = input;
  }
}
