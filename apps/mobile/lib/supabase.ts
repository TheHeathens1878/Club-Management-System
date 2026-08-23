import "react-native-url-polyfill/auto";

import { createReactNativeSupabaseClient, type TypedSupabaseClient } from "@club/shared";

import { authStorage } from "./auth-storage";
import { isSupabaseConfigured, missingSupabaseEnvVars, supabaseEnv } from "./env";

let client: TypedSupabaseClient | null = null;

/**
 * The one Supabase client the app uses. It is always the *user* client (anon
 * key + the signed-in session), so every read and write is subject to RLS —
 * there is no service-role path on a device.
 *
 * Created lazily so a missing .env renders the configuration screen in
 * app/_layout.tsx instead of throwing during module evaluation.
 */
export function getSupabase(): TypedSupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      `Missing Supabase configuration: ${missingSupabaseEnvVars.join(", ")}`,
    );
  }
  client ??= createReactNativeSupabaseClient(supabaseEnv, authStorage);
  return client;
}

/** The current session's access token, or null when signed out. */
export async function accessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
