/*
 * AoM SC Portal — service worker.
 *
 * This file exists for ONE reason: a browser will not hand out a Web Push
 * subscription without a service worker, and on iOS it will not hand one out
 * at all until the site is on the Home Screen. It is a push receiver and
 * nothing else.
 *
 * IT DOES NOT CACHE. The manifest has always said "nothing here claims
 * offline", and that is still true: every screen in this app is a live read of
 * the member's own data under RLS, so a cached copy would be a stale copy of
 * somebody's safeguarding-scoped record sitting in a browser profile. There is
 * no `fetch` handler at all, deliberately — adding one that just passes
 * through would slow every request down for nothing, and adding one that
 * caches would be a data-retention decision nobody has made.
 *
 * Hand-written, no build plugin (no Workbox / next-pwa / serwist): the whole
 * behaviour is forty lines, and a generated worker would bring a caching
 * strategy with it that we have just said we do not want.
 */

const DEFAULT_TITLE = "AoM SC Portal";
const ICON = "/icon-192.png";
// The small monochrome mark Android draws in the status bar. It is the same
// crest PNG — Android will desaturate it — rather than a second asset to keep
// in step with the badge.
const BADGE = "/icon-192.png";

self.addEventListener("install", () => {
  // A new worker should take over immediately. There is no cache to migrate,
  // so the usual reason to wait (a half-updated cache) does not apply, and
  // waiting would leave a member on an old worker after a deploy.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/*
 * A push MUST result in a visible notification: every browser grants the
 * subscription on `userVisibleOnly: true`, and one that shows nothing gets the
 * origin's permission revoked. So the parsing below never throws its way out
 * of showing something — a malformed or bodyless push still puts the club's
 * name on the lock screen, which is the honest failure.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Not JSON. Whatever arrived is more use to the member as text than not
    // at all, and `event.data.text()` cannot throw the way `.json()` can.
    try {
      payload = { body: event.data ? event.data.text() : "" };
    } catch {
      payload = {};
    }
  }
  if (typeof payload !== "object" || payload === null) payload = {};

  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title : DEFAULT_TITLE;
  const body = typeof payload.body === "string" ? payload.body : "";
  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/notifications";
  // Same tag ⇒ the second push about one conversation replaces the first
  // rather than stacking. The dispatcher sends the entity id as the tag.
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag : undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: ICON,
      badge: BADGE,
      tag,
      // A replacement should still buzz: the club sends few enough of these
      // that a silent update would just look like nothing happened.
      renotify: Boolean(tag),
      data: { url },
    })
  );
});

/*
 * Tapping the notification should land on the thing it is about, in the window
 * the member already has open if there is one — opening a second copy of a
 * standalone PWA is disorienting and loses whatever they were part-way through.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              // Cross-origin or a client that refuses to navigate: focusing it
              // is still better than a second window.
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })()
  );
});

/*
 * `pushsubscriptionchange` — NOT handled by writing to the database, and here
 * is why.
 *
 * The subscription row lives in `public.push_tokens`, written by the browser
 * with the member's own Supabase client so that `can_act_for()` is the gate.
 * A service worker holds no such client: it cannot run the auth refresh, and
 * there is deliberately no `/api/push` route standing in front of the table
 * for it to post to. Inventing one just for this event would be a second,
 * service-key-shaped way into the device register — a worse trade than the
 * gap it closes.
 *
 * The gap is small and self-healing. When the endpoint rotates, the old one is
 * dead, so the very next send gets a 404/410 and `comms-dispatch` prunes the
 * row; and the next time the member opens the app, the page reconciles the
 * live subscription into the table under their own RLS. All this handler does
 * is re-subscribe with the same application server key so the browser has a
 * working endpoint ready, and nudge any open window to write it down now
 * rather than on the next visit. Safari does not fire the event at all, which
 * is a further reason not to build the delivery path on it.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const key =
        event.oldSubscription &&
        event.oldSubscription.options &&
        event.oldSubscription.options.applicationServerKey;
      if (!key) return;

      let subscription;
      try {
        subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      } catch {
        return; // Permission gone, or the push service refused. The page will retry.
      }

      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        client.postMessage({ type: "push-subscription-changed", subscription: subscription.toJSON() });
      }
    })()
  );
});
