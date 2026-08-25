/**
 * `@mentions` in a message body — the pure half.
 *
 * Adam, 2026-08-25: "in messaging, I want you to facilitate using @ to notify
 * another member of the group."
 *
 * Two jobs live here, both pure so they can be unit-tested without a browser
 * and — this is the part that matters — so the COMPOSER, the SERVER and the
 * BUBBLE all agree about what counts as a mention:
 *
 *   1. `findMentionQuery` / `applyMention` — the composer's picker: where the
 *      half-typed `@…` starts and ends, and what the box says once a name is
 *      chosen.
 *   2. `matchMentions` / `splitMentions` — turning a finished body back into
 *      the people it names. The SEND PATH runs this server-side against the
 *      conversation's live participants (the client's list is never trusted),
 *      and the bubble runs it again to draw the chips.
 *
 * WHY NAMES AND NOT MARKUP: the message body is what the member typed and what
 * the safeguarding export shows. Storing `@[Ron One](uuid)` in it would put a
 * uuid in front of a reader and in front of the lead's export. So the body
 * stays plain text and the RESOLVED people are stored separately, in
 * `public.message_mentions` — that table, not this parser, is what makes a
 * mention resolvable later.
 *
 * MATCHING RULES (deliberate, and tested):
 *   * A mention starts at an `@` that is at the start of the text or follows
 *     whitespace or an opening bracket — never mid-word, so an email address
 *     is not a mention.
 *   * The longest candidate name that follows wins, so "@Ron Oneal" is Ron
 *     Oneal and not Ron One.
 *   * A candidate's FIRST NAME alone matches only when no other candidate
 *     shares it. Two Sarahs in a group means neither answers to "@Sarah", and
 *     that is the safe way round: a mention that could be either person is not
 *     a mention of either.
 *   * Matching is case-insensitive and ignores the punctuation that follows
 *     ("@Ron One, can you…").
 */

/** Someone who can be mentioned: a live participant of this conversation. */
export type MentionCandidate = { person_id: string; name: string };

/** Where the half-typed `@…` sits in the composer. */
export type MentionQuery = { start: number; end: number; query: string };

/** One resolved mention: who, and the exact span of text that named them. */
export type MentionMatch = { person_id: string; name: string; start: number; end: number };

/** How much text after an `@` the composer will still treat as one query. */
const MAX_QUERY_LENGTH = 40;

/** What may sit immediately before an `@` for it to open a mention. */
function opensMention(ch: string | undefined): boolean {
  return ch === undefined || /[\s([{<"'‘“]/.test(ch);
}

/** What may sit immediately after a name without swallowing the next word. */
function closesMention(ch: string | undefined): boolean {
  return ch === undefined || !/[\p{L}\p{N}]/u.test(ch);
}

function fold(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The composer: is the caret inside an `@…` the picker should answer?
 *
 * Returns the span from the `@` to the caret and the text between them, or
 * `null` when there is nothing to pick. The query may hold one space (people
 * have two names) but never a newline, and it gives up after
 * `MAX_QUERY_LENGTH` so a paragraph beginning with `@` does not keep a picker
 * open over it.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const at = Math.max(0, Math.min(caret, text.length));
  for (let i = at - 1; i >= 0 && at - i <= MAX_QUERY_LENGTH + 1; i -= 1) {
    const ch = text[i]!;
    if (ch === "@") {
      if (!opensMention(text[i - 1])) return null;
      const query = text.slice(i + 1, at);
      // One space is a middle name away from a surname; two means the member
      // moved on and the `@` was just an `@`.
      if (/\n/.test(query) || query.split(" ").length > 3) return null;
      return { start: i, end: at, query };
    }
    if (ch === "\n") return null;
  }
  return null;
}

/**
 * The candidates a half-typed query should offer, best first.
 *
 * An empty query offers everyone (typing `@` alone shows the room). Otherwise
 * a candidate matches when the query is a prefix of the whole name or of any
 * word in it — "@one" finds Ron One, and so does "@ron o".
 */
export function filterCandidates(candidates: MentionCandidate[], query: string): MentionCandidate[] {
  const needle = fold(query);
  if (needle === "") return [...candidates];
  const scored: { candidate: MentionCandidate; rank: number }[] = [];
  for (const candidate of candidates) {
    const name = fold(candidate.name);
    if (name.startsWith(needle)) {
      scored.push({ candidate, rank: 0 });
      continue;
    }
    if (name.split(" ").some((word) => word.startsWith(needle))) {
      scored.push({ candidate, rank: 1 });
      continue;
    }
    if (name.includes(needle)) scored.push({ candidate, rank: 2 });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.candidate.name.localeCompare(b.candidate.name))
    .map((s) => s.candidate);
}

/**
 * Put a chosen name into the box: the `@…` span becomes `@First Last ` and the
 * caret lands after the trailing space, ready for the next word.
 */
export function applyMention(
  text: string,
  span: MentionQuery,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name.trim()} `;
  const next = text.slice(0, span.start) + inserted + text.slice(span.end);
  return { text: next, caret: span.start + inserted.length };
}

/**
 * Every name a candidate answers to, longest first — the full name always, and
 * the first name only when it belongs to exactly one candidate.
 */
function aliasIndex(candidates: MentionCandidate[]): { alias: string; candidate: MentionCandidate }[] {
  const firstNameOwners = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const first = fold(candidate.name).split(" ")[0] ?? "";
    if (!first) continue;
    const owners = firstNameOwners.get(first) ?? new Set<string>();
    owners.add(candidate.person_id);
    firstNameOwners.set(first, owners);
  }

  const aliases: { alias: string; candidate: MentionCandidate }[] = [];
  for (const candidate of candidates) {
    const full = fold(candidate.name);
    if (!full) continue;
    aliases.push({ alias: full, candidate });
    const first = full.split(" ")[0]!;
    if (first !== full && (firstNameOwners.get(first)?.size ?? 0) === 1) {
      aliases.push({ alias: first, candidate });
    }
  }
  // Longest alias first: "ron oneal" must be tried before "ron one".
  return aliases.sort((a, b) => b.alias.length - a.alias.length);
}

/**
 * Every mention in a finished body, in the order they were typed.
 *
 * Spans never overlap and the same person may appear more than once — the
 * caller decides whether that is one notification (it is) or two chips (it is).
 */
export function matchMentions(text: string, candidates: MentionCandidate[]): MentionMatch[] {
  if (!text || candidates.length === 0) return [];
  const aliases = aliasIndex(candidates);
  const lower = text.toLowerCase();
  const found: MentionMatch[] = [];

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "@" || !opensMention(text[i - 1])) continue;
    for (const { alias, candidate } of aliases) {
      const end = i + 1 + alias.length;
      // Exact, character for character, on the lowercased text — an alias is
      // already space-collapsed, so this admits case differences and nothing
      // else. "@ Ron One" (a space after the @) is not a mention.
      if (lower.slice(i + 1, end) !== alias) continue;
      if (!closesMention(text[end])) continue;
      found.push({ person_id: candidate.person_id, name: candidate.name, start: i, end });
      i = end - 1;
      break;
    }
  }
  return found;
}

/** The distinct people a body mentions, first mention first. */
export function mentionedPersonIds(text: string, candidates: MentionCandidate[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const match of matchMentions(text, candidates)) {
    if (seen.has(match.person_id)) continue;
    seen.add(match.person_id);
    ids.push(match.person_id);
  }
  return ids;
}

/** A body cut into plain runs and mention runs, for rendering. */
export type MentionSegment = { text: string; person_id: string | null };

/**
 * The bubble's view of a body: alternating plain text and mentions, with no
 * character lost or duplicated (the tests assert that the pieces rejoin into
 * exactly the original body).
 */
export function splitMentions(text: string, candidates: MentionCandidate[]): MentionSegment[] {
  const matches = matchMentions(text, candidates);
  if (matches.length === 0) return text ? [{ text, person_id: null }] : [];

  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start), person_id: null });
    segments.push({ text: text.slice(match.start, match.end), person_id: match.person_id });
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), person_id: null });
  return segments;
}

/** The one-line excerpt a mention notification carries. */
export function mentionExcerpt(body: string, limit = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}
