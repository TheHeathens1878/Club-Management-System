/**
 * Pure formatting for the thread: London-wall-clock labels and the one place
 * a message body is turned into what a reader may see. Kept out of the client
 * component so the quote preview and the bubble can never disagree about a
 * deleted or redacted body (SG-8: a redaction must not leak through a quote).
 */

export type BodyState = "ok" | "deleted" | "redacted";

export function bodyState(m: { deleted_at: string | null; redacted_at: string | null }): BodyState {
  if (m.deleted_at) return "deleted";
  if (m.redacted_at) return "redacted";
  return "ok";
}

/** What a reader may see of a body — the ONLY accessor the UI uses. */
export function visibleBody(m: {
  body: string;
  deleted_at: string | null;
  redacted_at: string | null;
}): { state: BodyState; text: string } {
  const state = bodyState(m);
  if (state === "deleted") return { state, text: "Message deleted" };
  if (state === "redacted") return { state, text: "[removed by the safeguarding lead]" };
  return { state, text: m.body };
}

const LONDON = "Europe/London";

/** London calendar day of an instant, `YYYY-MM-DD` — the day-separator key. */
export function dayKey(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString("en-CA", { timeZone: LONDON });
}

/** `Today` / `Yesterday` / `Monday 18 August 2026`, WhatsApp-style. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const key = dayKey(iso);
  if (key === "") return "";
  const today = now.toLocaleDateString("en-CA", { timeZone: LONDON });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", {
    timeZone: LONDON,
  });
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: LONDON,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** `14:05`, London. */
export function clockLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString("en-GB", {
    timeZone: LONDON,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** Same sender, close enough in time to sit in one visual run. */
export function sameRun(
  a: { sender_person_id: string; created_at: string },
  b: { sender_person_id: string; created_at: string },
  maxGapMs = 5 * 60 * 1000,
): boolean {
  if (a.sender_person_id !== b.sender_person_id) return false;
  if (dayKey(a.created_at) !== dayKey(b.created_at)) return false;
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  return Math.abs(tb - ta) <= maxGapMs;
}
