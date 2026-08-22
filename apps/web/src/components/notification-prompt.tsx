"use client";

import { useState, useEffect } from "react";
import { Bell, BellOff, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const INSTALL_DISMISS_KEY = "pwa-install-dismissed";
const NOTIF_DISMISS_KEY = "pwa-notif-dismissed";
const DISMISS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function wasDismissedRecently(key: string) {
  const val = localStorage.getItem(key);
  return !!(val && Date.now() - Number(val) < DISMISS_TTL);
}

function isIosSafari() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios|opios/i.test(ua);
}

function isStandalone() {
  return (
    ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

// ── Main banner shown on all pages ───────────────────────────────────────────

export function NotificationPrompt() {
  const [step, setStep] = useState<"idle" | "ios-install" | "android-install" | "notifications">("idle");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Register the service worker early so Chrome sees the fetch handler and
    // fires beforeinstallprompt for both desktop and mobile install.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const ios = isIosSafari();
    const standalone = isStandalone();
    const installDismissed = wasDismissedRecently(INSTALL_DISMISS_KEY);
    const notifDismissed = wasDismissedRecently(NOTIF_DISMISS_KEY);
    const hasVapid = !!VAPID_PUBLIC_KEY;
    const canNotif =
      hasVapid &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      Notification.permission !== "granted" &&
      Notification.permission !== "denied" &&
      !notifDismissed;

    // iOS: show install instructions if in Safari and not yet installed
    if (ios && !standalone && !installDismissed) {
      setStep("ios-install");
      return;
    }

    // For non-iOS: always register the install prompt listener (fires on Android/Chrome/Desktop).
    // Must be registered before any early return so we catch it whenever the browser fires it.
    const handler = (e: Event) => {
      e.preventDefault();
      if (!installDismissed) {
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        setStep("android-install");
      }
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Show notifications banner while waiting; install prompt will override when it fires.
    // iOS standalone: only then can we request push (iOS 16.4+)
    // Non-iOS: can always request notifications
    if (canNotif && (!ios || standalone)) {
      setStep("notifications");
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismissInstall() {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    setDeferredPrompt(null);
    // After dismissing install, check if we can show notifications
    const canNotif =
      VAPID_PUBLIC_KEY &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      Notification.permission !== "granted" &&
      Notification.permission !== "denied" &&
      !wasDismissedRecently(NOTIF_DISMISS_KEY);
    setStep(canNotif ? "notifications" : "idle");
  }

  function dismissNotif() {
    localStorage.setItem(NOTIF_DISMISS_KEY, String(Date.now()));
    setStep("idle");
  }

  async function handleAndroidInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setStep("idle");
  }

  async function handleEnableNotifications() {
    setSaving(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        await fetch("/api/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
      }
      setStep("idle");
    } catch (err) {
      console.error("Notification subscribe failed:", err);
    } finally {
      setSaving(false);
    }
  }

  if (step === "idle") return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-3 lg:p-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-sm rounded-xl border bg-card shadow-lg">

        {/* iOS install instructions */}
        {step === "ios-install" && (
          <div className="p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <p className="text-sm font-semibold">Install the USC Sale app</p>
              <button onClick={dismissInstall} className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground -mt-0.5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Add to your Home Screen for quick access and push notifications.
            </p>
            <ol className="space-y-2 text-xs">
              <li className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">1</span>
                <span>Tap the <strong>Share</strong> button
                  {/* iOS share icon */}
                  <svg className="inline-block ml-1 mb-0.5" width="13" height="16" viewBox="0 0 13 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0.5" y="4.5" width="12" height="11" rx="1.5" stroke="currentColor"/>
                    <path d="M6.5 0.5V10M3.5 3.5L6.5 0.5L9.5 3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {" "}in Safari
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">2</span>
                <span>Scroll down and tap <strong>Add to Home Screen</strong></span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">3</span>
                <span>Tap <strong>Add</strong> to confirm</span>
              </li>
            </ol>
          </div>
        )}

        {/* Android/Chrome/Desktop install */}
        {step === "android-install" && (
          <div className="flex items-center gap-3 p-4">
            <Download className="h-5 w-5 shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Install the USC Sale app</p>
              <p className="text-xs text-muted-foreground">Install as an app for faster access.</p>
            </div>
            <Button size="sm" onClick={handleAndroidInstall}>Install</Button>
            <button onClick={dismissInstall} className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Notification permission */}
        {step === "notifications" && (
          <div className="flex items-center gap-3 p-4">
            <Bell className="h-5 w-5 shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Enable notifications</p>
              <p className="text-xs text-muted-foreground">Get club announcements and reminders.</p>
            </div>
            <Button size="sm" onClick={handleEnableNotifications} disabled={saving}>
              {saving ? "…" : "Enable"}
            </Button>
            <button onClick={dismissNotif} className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Account page toggle (manage subscription after the fact) ─────────────────

export function NotificationToggle() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if ("Notification" in window) {
      setEnabled(Notification.permission === "granted");
    }
    setLoading(false);
  }, []);

  async function handleToggle() {
    setSaving(true);
    if (enabled) {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await fetch("/api/push", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        }
        setEnabled(false);
      } catch (err) {
        console.error("Failed to unsubscribe:", err);
      }
    } else {
      try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          const reg = await navigator.serviceWorker.register("/sw.js");
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
          await fetch("/api/push", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sub.toJSON()),
          });
          setEnabled(true);
        }
      } catch (err) {
        console.error("Failed to subscribe:", err);
      }
    }
    setSaving(false);
  }

  if (loading || !("Notification" in window) || !("serviceWorker" in navigator) || !VAPID_PUBLIC_KEY) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {enabled ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
        <div>
          <p className="text-sm font-medium">Push notifications</p>
          <p className="text-xs text-muted-foreground">
            {enabled ? "You'll receive club announcements" : "Notifications are off"}
          </p>
        </div>
      </div>
      <Button size="sm" variant={enabled ? "destructive" : "outline"} onClick={handleToggle} disabled={saving}>
        {saving ? "…" : enabled ? "Disable" : "Enable"}
      </Button>
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
