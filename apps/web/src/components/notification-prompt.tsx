"use client";

/**
 * "Ask the user to create the app as a web app with notifications enabled"
 * (Adam, 2026-09-01).
 *
 * The portal is used on phones through Safari and Chrome, and on iOS those two
 * requests are ONE request: Safari will not issue a push subscription to a
 * site running in a tab, only to one that has been added to the Home Screen.
 * So this banner does not offer "enable notifications" to somebody who cannot
 * have them — it offers the install, says plainly that notifications come with
 * it, and asks for the permission on the next visit, when the app opens
 * standalone.
 *
 * On Android and desktop Chrome the browser tells us when it is willing to
 * install (`beforeinstallprompt`); notifications work either way, so the
 * install is offered when it is available and never insisted on.
 *
 * WHAT IT WILL NOT DO
 *   · appear at all with no VAPID key configured — there would be nothing
 *     behind the permission;
 *   · appear when this browser is already subscribed, or has already said no
 *     at the browser level (`permission === "denied"`), because a banner
 *     cannot undo that and pretending otherwise wastes the member's time;
 *   · call `Notification.requestPermission()` anywhere but inside a tap. iOS
 *     discards a request made outside a user gesture, and a discarded request
 *     still burns the one chance the origin gets;
 *   · come back the day after it is dismissed — see DISMISSALS below.
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Bell, BellOff, Share, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  currentSubscription,
  deviceLabel,
  disableWebPush,
  enableWebPush,
  isIosSafari,
  installSupported,
  isStandalone,
  pushSupported,
  reconcileSubscription,
  VAPID_PUBLIC_KEY,
} from "@/lib/push-subscription";

/*
 * DISMISSALS. Two keys, two different lengths, for two different decisions.
 * "Not now" to notifications is a mood — a week later is a fair time to ask
 * again. "I am not installing this" is a settled preference, and asking a
 * parent every seventh Sunday is exactly the behaviour that gets an app's
 * banner ignored on sight, so that one waits a month.
 */
const INSTALL_DISMISSED = "aomsc-install-dismissed";
const NOTIFICATIONS_DISMISSED = "aomsc-notifications-dismissed";
const INSTALL_TTL = 30 * 24 * 60 * 60 * 1000;
const NOTIFICATIONS_TTL = 7 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function dismissedRecently(key: string, ttl: number): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value !== null && Date.now() - Number(value) < ttl;
  } catch {
    // Safari in private browsing throws on localStorage. Erring towards
    // showing the banner is the wrong side to err on for a nag, so treat an
    // unreadable store as "recently dismissed".
    return true;
  }
}

function remember(key: string) {
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    /* nothing to do; the banner simply reappears next time */
  }
}

type Step = "hidden" | "ios-install" | "install" | "enable";

// The crest, at the size the mobile header draws it.
function Badge() {
  return (
    <Image
      src="/icon-192.png"
      alt=""
      width={40}
      height={40}
      className="h-10 w-10 shrink-0 rounded-lg"
      unoptimized
    />
  );
}

export function NotificationPrompt({ personId }: { personId: string | null }) {
  const [step, setStep] = useState<Step>("hidden");
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);
  /** Why turning them on did not work, when the browser gave a reason. */
  const [trouble, setTrouble] = useState<string | null>(null);

  // The two halves are asked separately (Adam, 2026-09-02). Notifications need
  // a VAPID key to be configured; putting the club on a Home Screen does not,
  // and on iOS it is the PRECONDITION of notifications rather than a
  // consequence of them — so gating the install behind the push check meant
  // that with no key configured the app offered neither, which is what it was
  // doing on production this morning.
  const canPush = pushSupported();
  const canInstall = installSupported();

  useEffect(() => {
    if (!personId || (!canPush && !canInstall)) return;

    let cancelled = false;

    // Chrome fires this once, early, and only when it is prepared to install.
    // The listener goes on before the async work below so nothing is missed.
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      if (cancelled) return;
      setInstallEvent(event as BeforeInstallPromptEvent);
      setStep((current) => (current === "enable" || current === "hidden" ? "install" : current));
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // The worker rotated our endpoint (see public/sw.js) — it cannot write to
    // the table itself, so it hands the new subscription to whoever is open.
    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "push-subscription-changed") void reconcileSubscription(personId);
    };
    navigator.serviceWorker.addEventListener("message", onWorkerMessage);

    void (async () => {
      // Registering the worker early is also what makes Chrome consider the
      // site installable in the first place.
      await navigator.serviceWorker.register("/sw.js").catch(() => {});

      if (canPush) {
        const subscription = await currentSubscription().catch(() => null);
        if (cancelled) return;

        if (subscription) {
          // Already on, and installed or not, there is nothing left to ask.
          // Make sure the table agrees — a member who cleared site data and
          // came back has a subscription we have never seen.
          void reconcileSubscription(personId);
          return;
        }
      }

      const standalone = isStandalone();
      // Already on the Home Screen: the install half has nothing to say, so
      // this is only ever the notifications question, and only if it can be
      // answered.
      if (standalone) {
        if (canPush
            && Notification.permission !== "denied"
            && !dismissedRecently(NOTIFICATIONS_DISMISSED, NOTIFICATIONS_TTL)) {
          setStep((current) => (current === "install" ? current : "enable"));
        }
        return;
      }

      if (isIosSafari()) {
        if (!dismissedRecently(INSTALL_DISMISSED, INSTALL_TTL)) setStep("ios-install");
        return;
      }
      // Android and desktop Chrome: `beforeinstallprompt` decides whether the
      // install is offered, and the listener above sets that step when it
      // fires. Notifications can be asked for in a tab, so they are.
      if (canPush
          && Notification.permission !== "denied"
          && !dismissedRecently(NOTIFICATIONS_DISMISSED, NOTIFICATIONS_TTL)) {
        setStep((current) => (current === "install" ? current : "enable"));
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      navigator.serviceWorker.removeEventListener("message", onWorkerMessage);
    };
  }, [personId, canPush, canInstall]);

  const dismissInstall = useCallback(() => {
    remember(INSTALL_DISMISSED);
    setInstallEvent(null);
    setStep(
      canPush && !dismissedRecently(NOTIFICATIONS_DISMISSED, NOTIFICATIONS_TTL) ? "enable" : "hidden",
    );
  }, [canPush]);

  const dismissEnable = useCallback(() => {
    remember(NOTIFICATIONS_DISMISSED);
    setStep("hidden");
  }, []);

  const dismissIos = useCallback(() => {
    remember(INSTALL_DISMISSED);
    setStep("hidden");
  }, []);

  async function handleInstall() {
    if (!installEvent) return;
    setBusy(true);
    try {
      await installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      setInstallEvent(null);
      // Accepted or not, notifications are the point where they can be had.
      setStep(
        canPush && (outcome === "accepted" || !dismissedRecently(NOTIFICATIONS_DISMISSED, NOTIFICATIONS_TTL))
          ? "enable"
          : "hidden",
      );
    } finally {
      setBusy(false);
    }
  }

  // Straight off the tap — see the note at the top of the file.
  async function handleEnable() {
    if (!personId) return;
    setBusy(true);
    setTrouble(null);
    try {
      const result = await enableWebPush(personId);
      if (result.status === "subscribed" || result.status === "denied") {
        setStep("hidden");
        return;
      }
      if (result.status === "error" || result.status === "unsupported") {
        // Something went wrong, and the reader is owed the reason. Dismissing
        // the banner here would hide the only evidence there is (Adam,
        // 2026-09-01: it "hangs on 'Just a second'").
        setTrouble(
          result.status === "unsupported"
            ? "This browser cannot take notifications from a website."
            : (result.message ?? "Notifications could not be turned on."),
        );
        return;
      }
      // "Not now" at the browser's own dialog: a decision, so respect it.
      remember(NOTIFICATIONS_DISMISSED);
      setStep("hidden");
    } finally {
      setBusy(false);
    }
  }

  if (!VAPID_PUBLIC_KEY || step === "hidden") return null;

  return (
    <div
      // Clear of the fixed mobile tab bar and the home indicator beneath it;
      // bottom-right and compact from lg, where there is no tab bar.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-40 px-3 lg:inset-x-auto lg:bottom-4 lg:right-4 lg:px-0"
      role="region"
      aria-label="App and notifications"
    >
      <div className="pointer-events-auto mx-auto w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg lg:mx-0">
        {step === "ios-install" && (
          <div>
            <div className="mb-3 flex items-start gap-3">
              <Badge />
              <div className="min-w-0 flex-1">
                <p className="font-display text-[15px] font-semibold uppercase tracking-wide">
                  Add AoM SC Portal to your Home Screen
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {canPush
                    ? "It opens like an app — and on an iPhone it is the only way the club can send you notifications, so this is the step that turns them on."
                    : "It opens like an app, full screen, with the crest on your Home Screen instead of a browser tab."}
                </p>
              </div>
              <button
                type="button"
                onClick={dismissIos}
                aria-label="Not now"
                className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ol className="space-y-2 text-xs">
              <li className="flex items-center gap-2.5">
                <StepNumber n={1} />
                <span className="inline-flex items-center gap-1">
                  Tap <Share className="h-3.5 w-3.5 text-primary" aria-hidden /> <strong>Share</strong> in Safari
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <StepNumber n={2} />
                <span>
                  Scroll down and tap <strong>Add to Home Screen</strong>
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <StepNumber n={3} />
                <span>
                  {canPush ? (
                    <>
                      Open it from your Home Screen, then tap{" "}
                      <strong>Turn on notifications</strong>
                    </>
                  ) : (
                    <>
                      Open it from your Home Screen — it signs you in as it is
                    </>
                  )}
                </span>
              </li>
            </ol>
          </div>
        )}

        {step === "install" && (
          <div className="flex items-start gap-3">
            <Badge />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] font-semibold uppercase tracking-wide">
                Install AoM SC Portal
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {canPush
                  ? "Keep the club on your home screen, and get match and message notifications."
                  : "Keep the club on your home screen — it opens full screen, like an app."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" className="min-h-[44px] lg:min-h-0" onClick={handleInstall} disabled={busy}>
                  Install
                </Button>
                {canPush && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-[44px] lg:min-h-0"
                    onClick={() => setStep("enable")}
                    disabled={busy}
                  >
                    Notifications only
                  </Button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={dismissInstall}
              aria-label="Not now"
              className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {step === "enable" && (
          <div className="flex items-start gap-3">
            <Badge />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] font-semibold uppercase tracking-wide">
                Turn on notifications
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Team messages, fixture changes and club announcements, on this device. You can turn
                them off again in Settings.
              </p>
              <div className="mt-3">
                <Button size="sm" className="min-h-[44px] lg:min-h-0" onClick={handleEnable} disabled={busy}>
                  <Bell className="h-4 w-4" />
                  {busy ? "Just a second…" : trouble ? "Try again" : "Turn on notifications"}
                </Button>
              </div>
              {trouble && (
                <p className="mt-2 text-xs text-destructive">
                  {trouble} You can carry on without them, and turn them on later under Settings.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={dismissEnable}
              aria-label="Not now"
              className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
      {n}
    </span>
  );
}

/**
 * The Settings half of the same thing.
 *
 * TWO DIFFERENT QUESTIONS, and the copy has to keep them apart or nobody will
 * ever work out why they are not getting anything:
 *
 *   · the "Push notification" checkbox above is a PREFERENCE
 *     (`comms_preferences`) — do I want the club to push to me at all. It is
 *     the member's, it follows them between devices, and a guardian sets it
 *     for their children too.
 *   · this is a DEVICE — does this particular phone, tablet or browser have a
 *     live subscription (`push_tokens`). It is per browser, and clearing site
 *     data or switching handsets loses it.
 *
 * Both have to be on. Turning the preference off stops everything; turning
 * this off stops only this device.
 */
export function DeviceNotifications({ personId }: { personId: string }) {
  const [state, setState] = useState<"loading" | "on" | "off" | "blocked" | "needs-install" | "unsupported">(
    "loading",
  );
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("this device");

  const refresh = useCallback(async () => {
    if (!pushSupported()) {
      setState("unsupported");
      return;
    }
    setLabel(deviceLabel());
    if (isIosSafari() && !isStandalone()) {
      setState("needs-install");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    const subscription = await currentSubscription().catch(() => null);
    setState(subscription ? "on" : "off");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === "loading" || !VAPID_PUBLIC_KEY) return null;

  async function toggle() {
    setBusy(true);
    try {
      if (state === "on") await disableWebPush();
      else await enableWebPush(personId);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="p-4 lg:p-6">
        <CardTitle className="text-base">This device</CardTitle>
        <p className="text-sm text-muted-foreground">
          The checkbox above is the club&apos;s standing instruction: whether you want push
          notifications at all. This is separate — whether <strong>{label}</strong> is one of the
          devices they arrive on. Both have to be on, and a phone that has never been asked will not
          buzz however the preference is set.
        </p>
      </CardHeader>
      <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
        {state === "unsupported" && (
          <p className="text-sm text-muted-foreground">
            This browser cannot receive push notifications. Chrome or Safari on a phone can.
          </p>
        )}

        {state === "needs-install" && (
          <p className="text-sm text-muted-foreground">
            On an iPhone or iPad, notifications only work once AoM SC Portal is on your Home Screen.
            Tap <strong>Share</strong> in Safari, then <strong>Add to Home Screen</strong>, open it
            from there and come back to this page.
          </p>
        )}

        {state === "blocked" && (
          <p className="text-sm text-muted-foreground">
            Notifications are blocked for this site in your browser&apos;s settings, so the club
            cannot ask again from here. Allow them for this site and this page will offer the switch.
          </p>
        )}

        {(state === "on" || state === "off") && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {state === "on" ? (
                <Bell className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <BellOff className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <p className="text-sm">
                {state === "on"
                  ? "Notifications arrive on this device."
                  : "This device is not set up to receive them."}
              </p>
            </div>
            <Button
              size="sm"
              variant={state === "on" ? "outline" : "default"}
              className="min-h-[44px] lg:min-h-0"
              onClick={toggle}
              disabled={busy}
            >
              {busy ? "…" : state === "on" ? "Turn off on this device" : "Turn on for this device"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
