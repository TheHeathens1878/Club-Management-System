import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@club/db";

export type TypedSupabaseClient = SupabaseClient<Database>;

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

/**
 * Platform-agnostic anon client. Web (SSR/cookies) and mobile (secure storage)
 * wrap this with their own auth storage; see apps/web and apps/mobile.
 */
export function createSupabaseClient(
  env: SupabaseEnv,
  options?: Parameters<typeof createClient<Database>>[2],
): TypedSupabaseClient {
  if (!env.url || !env.anonKey) {
    throw new Error("Supabase URL and anon key are required");
  }
  return createClient<Database>(env.url, env.anonKey, options);
}

/**
 * Minimal key/value contract gotrue needs for session persistence. Kept
 * structural so this package never has to depend on a native storage module.
 */
export interface SupabaseAuthStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

/**
 * Anon client for React Native. Identical to `createSupabaseClient` except the
 * auth defaults are the ones a native app needs:
 *  - sessions persist in the caller-supplied storage adapter (see
 *    apps/mobile/lib/auth-storage.ts — expo-secure-store with an AsyncStorage
 *    fallback);
 *  - `detectSessionInUrl` is off, because there is no browser URL to read —
 *    magic links arrive as a deep link the app parses itself;
 *  - PKCE, so the emailed link carries a one-time code rather than tokens.
 *
 * `autoRefreshToken` is on, but RN does not suspend timers reliably in the
 * background: callers should still drive `auth.startAutoRefresh()` /
 * `stopAutoRefresh()` from AppState.
 */
export function createReactNativeSupabaseClient(
  env: SupabaseEnv,
  storage: SupabaseAuthStorage,
  options?: Parameters<typeof createClient<Database>>[2],
): TypedSupabaseClient {
  return createSupabaseClient(env, {
    ...options,
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      ...options?.auth,
    },
  });
}
