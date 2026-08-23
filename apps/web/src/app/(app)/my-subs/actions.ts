"use server";

/**
 * "Pay now" (PLAN.md P4.1).
 *
 * The checkout session is created by the `stripe-checkout` Edge Function, not
 * here: it is the thing that holds the Stripe secret, and it re-checks under
 * the caller's own JWT that they are the payer. So this action's job is to
 * hand over the user's access token and follow the URL that comes back — and
 * to say something useful when Stripe is not configured yet.
 */

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string };

export async function startCheckout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subscriptionId = String(formData.get("subscription_id") ?? "");
  if (!subscriptionId) return { error: "No subscription given." };

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) return { error: "Your session has expired. Sign in again and retry." };

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return { error: "Payments are not configured for this site yet." };

  let response: Response;
  try {
    response = await fetch(`${base}/functions/v1/stripe-checkout`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      },
      body: JSON.stringify({ subscription_id: subscriptionId }),
    });
  } catch {
    return { error: "Could not reach the payment service. Try again in a minute." };
  }

  // 404 from the gateway means the function has not been deployed; 503 means
  // it is there but has no Stripe key. Both are set-up states, not user error.
  if (response.status === 404) {
    return { error: "Online payment is not switched on yet. Please pay the club directly." };
  }

  let payload: { url?: string; error?: string } = {};
  try {
    payload = (await response.json()) as { url?: string; error?: string };
  } catch {
    payload = {};
  }

  if (!response.ok || !payload.url) {
    if (response.status === 503) {
      return { error: "Online payment is not switched on yet. Please pay the club directly." };
    }
    return { error: payload.error ?? "The payment service could not start a checkout." };
  }

  redirect(payload.url);
}
