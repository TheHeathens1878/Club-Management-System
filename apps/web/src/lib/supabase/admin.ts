import { createClient } from "@supabase/supabase-js";

// Service-role client. SERVER-ONLY. Bypasses RLS — never import into client code.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
