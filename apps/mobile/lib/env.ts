/**
 * EXPO_PUBLIC_* variables are inlined into the bundle at build time, so they
 * must be read as literal `process.env.X` member expressions — never
 * dynamically. Anything secret (service-role key, Graph credentials) must never
 * carry the EXPO_PUBLIC_ prefix (PLAN §2.6): the device only ever gets the anon
 * key, and RLS is the security boundary.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseEnv = { url, anonKey };

export const isSupabaseConfigured = url.length > 0 && anonKey.length > 0;

/** Names to show the developer when configuration is missing. */
export const missingSupabaseEnvVars: string[] = [
  ...(url ? [] : ["EXPO_PUBLIC_SUPABASE_URL"]),
  ...(anonKey ? [] : ["EXPO_PUBLIC_SUPABASE_ANON_KEY"]),
];
