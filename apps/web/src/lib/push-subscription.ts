/**
 * The browser end of web push.
 *
 * Everything here runs in the page, never on the server, and writes to
 * `public.push_tokens` with the USER-SCOPED Supabase client. That is the whole
 * authorisation story: `push_tokens_self_all` is `can_act_for(person_id)`, so
 * the database decides whether this person may register a device for that
 * person, exactly as it decides for their comms preferences. There is no
 * `/api/push` route and there should not be one — a service-key route in front
 * of a table whose RLS already says the right thing is a second set of rules to
 * keep in step, and the imported function-room app's version of this file
 * called one only because it predated `push_tokens` existing.
 *
 * The iOS ordering is the reason the UI around this is shaped the way it is:
 * Safari refuses `pushManager.subscribe()` outright until the site has been
 * added to the Home Screen, and refuses `Notification.requestPermission()`
 * outside a real tap. Installing and enabling are one flow, not two.
 */

import type { Json } from "@club/db";

import { createClient } from "@/lib/supabase/client";

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export type EnableResult =
  | { status: "subscribed" }
  | { status: "denied" }
  | { status: "dismissed" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

/** Does this browser have the three pieces web push needs, and do we have a key? */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    VAPID_PUBLIC_KEY !== "" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Safari on iOS/iPadOS specifically — not Chrome or Firefox on iOS, which are
 * Safari underneath but cannot install to the Home Screen themselves, and so
 * need different advice.
 */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  const iOS = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  return iOS && /safari/i.test(ua) && !/crios|fxios|opios|edgios/i.test(ua);
}

/** Running from the Home Screen (or an installed desktop window) rather than a tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * Something a member can recognise in a list of their devices. Deliberately
 * coarse — the browser and the platform, no version, no fingerprint. It is a
 * label on a row that already identifies them, not a new piece of data about
 * them.
 */
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "Browser";
  const ua = navigator.userAgent;
  const platform = /iphone/i.test(ua)
    ? "iPhone"
    : /ipad/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /android/i.test(ua)
        ? "Android"
        : /macintosh/i.test(ua)
          ? "Mac"
          : /windows/i.test(ua)
            ? "Windows"
            : "Browser";
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /crios|chrome/i.test(ua)
      ? "Chrome"
      : /fxios|firefox/i.test(ua)
        ? "Firefox"
        : /safari/i.test(ua)
          ? "Safari"
          : "Browser";
  return `${browser} on ${platform}${isStandalone() ? " · Home Screen" : ""}`;
}

/** VAPID keys travel as base64url; `applicationServerKey` wants the raw bytes. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function uint8ToUrlBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The worker, registered once and awake. */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

/**
 * The live subscription for this browser, if there is one — and only if it was
 * issued for the key we are currently signing with. A subscription made under
 * an old VAPID pair still looks healthy to the browser but can never be
 * delivered to, so it is thrown away rather than reported as "on".
 */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const existing = await registration?.pushManager.getSubscription();
  if (!existing) return null;

  const key = existing.options?.applicationServerKey;
  if (key && uint8ToUrlBase64(new Uint8Array(key)) !== VAPID_PUBLIC_KEY) {
    await existing.unsubscribe().catch(() => {});
    return null;
  }
  return existing;
}

type SubscriptionJson = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: { p256dh?: string; auth?: string };
};

/**
 * Write the subscription down as this person's device.
 *
 * The endpoint IS the primary key (the migration's CHECK enforces
 * `token = web_subscription->>'endpoint'`), which is what lets `comms-dispatch`
 * prune a gone endpoint with a plain delete by token.
 *
 * THE SHARED-DEVICE CASE. A push endpoint belongs to the browser profile, not
 * to the person signed in, so on a family iPad the second member to enable
 * notifications collides with the first member's row — and RLS correctly
 * refuses to let them overwrite it. That is the right answer and the wrong
 * outcome, so on a refusal we throw the endpoint away and take a fresh one:
 * `unsubscribe()` then `subscribe()` yields a new address. The first member's
 * row now points at an endpoint nobody is listening on, and the push service
 * will 410 it away on the next send.
 */
async function storeSubscription(personId: string, subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON() as SubscriptionJson;
  const supabase = createClient();
  const { error } = await supabase.from("push_tokens").upsert(
    {
      token: subscription.endpoint,
      person_id: personId,
      platform: "web",
      web_subscription: json as unknown as Json,
      device_name: deviceLabel(),
    },
    { onConflict: "token" },
  );
  if (error) throw new Error(error.message);
}

async function subscribeFresh(registration: ServiceWorkerRegistration): Promise<PushSubscription> {
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  });
}

/**
 * Ask for permission and register this browser for `personId`.
 *
 * MUST be called straight from a tap: iOS discards a permission request that
 * is not inside a user gesture, and Chrome now does the same.
 */
export async function enableWebPush(personId: string): Promise<EnableResult> {
  if (!pushSupported()) return { status: "unsupported" };

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "permission request failed" };
  }
  if (permission === "denied") return { status: "denied" };
  if (permission !== "granted") return { status: "dismissed" };

  try {
    const registration = await readyRegistration();
    let subscription = (await currentSubscription()) ?? (await subscribeFresh(registration));
    try {
      await storeSubscription(personId, subscription);
    } catch {
      // See storeSubscription: almost always somebody else's row on a shared
      // browser. One retry on a brand-new endpoint, then give up honestly.
      await subscription.unsubscribe().catch(() => {});
      subscription = await subscribeFresh(registration);
      await storeSubscription(personId, subscription);
    }
    return { status: "subscribed" };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "could not subscribe" };
  }
}

/**
 * Stop this browser receiving pushes: the row goes, and so does the
 * subscription. Both halves matter — deleting the row alone leaves the browser
 * holding a live endpoint that would come back on the next reconcile, and
 * unsubscribing alone leaves a row the dispatcher wastes a send on until the
 * push service reports it gone.
 */
export async function disableWebPush(): Promise<void> {
  if (!pushSupported()) return;
  const subscription = await currentSubscription();
  if (!subscription) return;

  const supabase = createClient();
  await supabase.from("push_tokens").delete().eq("token", subscription.endpoint);
  await subscription.unsubscribe().catch(() => {});
}

/**
 * Bring the table back into step with what this browser actually holds.
 *
 * Called on load, and when the service worker reports that the push service
 * rotated the endpoint underneath us (`pushsubscriptionchange`, which the
 * worker cannot write down itself — see the comment in public/sw.js).
 */
export async function reconcileSubscription(personId: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  await storeSubscription(personId, subscription).catch(() => {});
}
