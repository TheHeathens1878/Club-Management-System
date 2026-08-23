import { createClient } from "@supabase/supabase-js";
import type { Database } from "@club/db";

// Service-role client. SERVER-ONLY. Bypasses RLS — never import into client code.
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
