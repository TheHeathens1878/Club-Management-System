import * as WebBrowser from "expo-web-browser";

import { edgeFunctionUrl, supabaseEnv } from "./env";
import { accessToken } from "./supabase";

/**
 * Paying a sub.
 *
 * This is deliberately **web checkout, not a native payment sheet**: the app
 * asks the `stripe-checkout` Edge Function (P4.1) for a Stripe Checkout
 * Session URL and opens it in the system browser. Nothing about card entry
 * happens inside the app.
 *
 * Why, for this pass:
 *  - no native Stripe module (`@stripe/stripe-react-native`) means no config
 *    plugin, no Apple Pay / Google Pay entitlements and no extra store review
 *    surface before P6.4;
 *  - the same Edge Function already serves the web app, so there is one
 *    checkout path and one webhook (`stripe-webhook`) writing the ledger;
 *  - PLAN P6.2 names a payment sheet, so swapping this for
 *    `@stripe/stripe-react-native` + a PaymentIntent is a follow-up, not a
 *    rewrite: the Edge Function contract does not change.
 *
 * The session's access token is sent as a bearer token, so the function runs
 * with a *user*-scoped client and RLS decides whether the caller may pay this
 * subscription. No key beyond the anon key ever leaves the device.
 */

export type CheckoutResult =
  | { ok: true; dismissed: boolean }
  | { ok: false; error: string };

interface CheckoutResponse {
  url?: unknown;
  error?: unknown;
}

export async function paySubscription(
  subscriptionId: string,
): Promise<CheckoutResult> {
  const token = await accessToken();
  if (!token) {
    return { ok: false, error: "You have been signed out. Sign in and retry." };
  }

  let response: Response;
  try {
    response = await fetch(edgeFunctionUrl("stripe-checkout"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Supabase's gateway wants both: the project key to route the request
        // and the user's token so `verify_jwt` and RLS see a real person.
        apikey: supabaseEnv.anonKey,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ subscription_id: subscriptionId }),
    });
  } catch {
    return {
      ok: false,
      error: "No connection to the club's payment service. Try again.",
    };
  }

  let payload: CheckoutResponse = {};
  try {
    payload = (await response.json()) as CheckoutResponse;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : `Checkout failed (${response.status}).`;
    return { ok: false, error: message };
  }

  const url = typeof payload.url === "string" ? payload.url : null;
  if (!url) {
    return { ok: false, error: "Stripe did not return a checkout link." };
  }

  // An in-app browser tab, not `Linking.openURL`: the session cookie stays in
  // a tab the user can dismiss, and control comes straight back to the app.
  const result = await WebBrowser.openBrowserAsync(url, {
    dismissButtonStyle: "close",
    enableBarCollapsing: true,
  });

  return { ok: true, dismissed: result.type === "dismiss" };
}

/** Opens a web-app page (the admin views on the profile tab) in the browser. */
export async function openWebPage(url: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url, { enableBarCollapsing: true });
}
