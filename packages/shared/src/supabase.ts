import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@club/db";

export type TypedSupabaseClient = SupabaseClient<Database>;

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

/**
 * Platform-agnostic anon client. Web (SSR/cookies) and mobile (AsyncStorage)
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
