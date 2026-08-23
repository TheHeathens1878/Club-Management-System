import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { normalisePlatform, routeForPushData } from "./push";
import { getSupabase } from "./supabase";

/**
 * Push notifications.
 *
 * Registration: ask on the first launch *after* sign-in (never before — a
 * permission prompt on the sign-in screen has nothing to justify it), then
 * store the Expo push token in `push_tokens`. That table is self-managed under
 * RLS (P5.5): a person may write only their own row, and only `service_role`
 * reads it, which is what lets `comms-dispatch` fan a message out without the
 * device ever holding a privileged key.
 *
 * Handling: `push-fanout` sends `data: { entity: "conversations", entity_id }`,
 * so a tapped notification navigates to `/messages/<entity_id>`. The same
 * route is what the `aomclub://messages/<id>` deep link resolves to, so a link
 * from an email and a tapped push end up in the same place.
 *
 * Note the body may be absent: P5.5 omits the message body from the push when
 * the conversation involves a minor. The title still names the club, and the
 * thread is one tap away.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type PushStatus =
  | "unknown"
  | "unsupported"
  | "denied"
  | "granted"
  | "registered"
  | "error";

export interface PushState {
  status: PushStatus;
  token: string | null;
  error: string | null;
  /** Ask for permission and register; safe to call again. */
  enable: () => Promise<void>;
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

async function androidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("messages", {
    name: "Messages",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility:
      // A club message can involve a minor; do not put it on a locked screen.
      Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

/**
 * Registers this device against the signed-in person. Upserts on the token, so
 * reinstalling or handing the phone to another family member re-points the
 * existing row at whoever is signed in now instead of leaving a stale one.
 */
export async function storePushToken(
  personId: string,
  token: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("push_tokens")
    .upsert(
      {
        person_id: personId,
        token,
        platform: normalisePlatform(Platform.OS),
        device_name: Device.deviceName ?? null,
      },
      { onConflict: "token" },
    );
  if (error) throw error;
}

export function usePush(personId: string | null): PushState {
  const [status, setStatus] = useState<PushStatus>("unknown");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const askedRef = useRef(false);

  const register = useCallback(
    async (ask: boolean) => {
      if (!personId) return;

      if (!Device.isDevice) {
        setStatus("unsupported");
        return;
      }

      try {
        await androidChannel();

        const existing = await Notifications.getPermissionsAsync();
        let granted = existing.granted;
        if (!granted && ask && existing.canAskAgain) {
          const requested = await Notifications.requestPermissionsAsync();
          granted = requested.granted;
        }

        if (!granted) {
          setStatus("denied");
          return;
        }
        setStatus("granted");

        const expoToken = await Notifications.getExpoPushTokenAsync({
          projectId: projectId(),
        });
        await storePushToken(personId, expoToken.data);

        setToken(expoToken.data);
        setStatus("registered");
        setError(null);
      } catch (caught) {
        setStatus("error");
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not set up notifications on this device.",
        );
      }
    },
    [personId],
  );

  // First launch after sign-in: ask once, then never nag. Re-enabling later is
  // an explicit tap on the profile tab.
  useEffect(() => {
    if (!personId || askedRef.current) return;
    askedRef.current = true;
    void register(true);
  }, [personId, register]);

  const enable = useCallback(() => register(true), [register]);

  return { status, token, error, enable };
}

/**
 * Navigates to the conversation a notification is about — both for a tap while
 * the app is running and for the notification that cold-started it.
 */
export function usePushNavigation(ready: boolean): void {
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;

    const go = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handledRef.current === id) return;
      handledRef.current = id;

      const route = routeForPushData(
        response.notification.request.content.data,
      );
      if (route) router.push(route as never);
    };

    void Notifications.getLastNotificationResponseAsync().then(go);

    const subscription =
      Notifications.addNotificationResponseReceivedListener(go);
    return () => subscription.remove();
  }, [ready]);
}
