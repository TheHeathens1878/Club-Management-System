import webpush from "web-push";
import { createLegacyAdminClient } from "@/lib/supabase/legacy";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? "mailto:admin@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

/** Send a push notification to a specific user (all their subscribed devices) */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const admin = createLegacyAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) return;

  const jsonPayload = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        jsonPayload
      ).catch(async (err) => {
        // Remove expired/invalid subscriptions (410 Gone or 404)
        if (err.statusCode === 410 || err.statusCode === 404) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        }
        throw err;
      })
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return { sent, total: subs.length };
}

/** Send a push notification to all subscribed users */
export async function sendPushToAll(payload: PushPayload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const admin = createLegacyAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");

  if (!subs || subs.length === 0) return { sent: 0, total: 0 };

  const jsonPayload = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        jsonPayload
      ).catch(async (err) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        }
        throw err;
      })
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return { sent, total: subs.length };
}
