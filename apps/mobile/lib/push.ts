/**
 * Turning a push payload into a route.
 *
 * `push-fanout` (P5.5) enqueues each notification through `enqueue_message`
 * with `entity: "conversations"` and `entityId: <conversation id>`, and
 * `comms-dispatch` puts those on the Expo message as
 * `data: { entity, entity_id, template }`. So the only thing the app has to do
 * with a tapped notification is read `entity_id` and open that thread.
 *
 * Deliberately pure — no expo-notifications import — so it can be tested
 * (lib/push.test.ts) and so the registration module stays the only place that
 * touches native APIs.
 */

/** The deep-link scheme the club's push notifications use. */
export const MESSAGES_SCHEME = "aomclub://messages/";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * The conversation a notification is about, or null when it is about something
 * else (an arrears reminder, a certification nudge) or is malformed. Only
 * `entity: "conversations"` counts, so a future notification carrying some
 * other entity id can never be turned into a messages route.
 */
export function conversationIdFromPushData(
  data: unknown,
): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;

  const entity = asString(record.entity);
  if (entity !== null && entity !== "conversations") return null;

  const id =
    asString(record.entity_id) ??
    asString(record.entityId) ??
    asString(record.conversation_id) ??
    asString(record.conversationId);

  if (!id || !UUID.test(id)) return null;
  return id;
}

/** In-app route for a conversation. */
export function messagesRoute(conversationId: string): string {
  return `/messages/${conversationId}`;
}

/** The external deep link, e.g. from an email or the web app. */
export function messagesDeepLink(conversationId: string): string {
  return `${MESSAGES_SCHEME}${conversationId}`;
}

/**
 * Route to navigate to for a tapped notification, or null to stay put.
 */
export function routeForPushData(data: unknown): string | null {
  const conversationId = conversationIdFromPushData(data);
  return conversationId ? messagesRoute(conversationId) : null;
}

/** `aomclub://messages/<id>` → the conversation id it names. */
export function conversationIdFromDeepLink(url: string | null): string | null {
  if (!url) return null;
  const match = /messages\/([0-9a-f-]{36})/i.exec(url);
  const id = match?.[1];
  if (!id || !UUID.test(id)) return null;
  return id;
}

export type DevicePlatform = "ios" | "android" | "web";

/** `push_tokens.platform` is free text; keep it to the three we ever send. */
export function normalisePlatform(value: string): DevicePlatform {
  const lowered = value.toLowerCase();
  if (lowered === "ios") return "ios";
  if (lowered === "android") return "android";
  return "web";
}
