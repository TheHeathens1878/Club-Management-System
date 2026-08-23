import { createClient } from "@supabase/supabase-js";

/**
 * Untyped service-role client — SERVER-ONLY, bypasses RLS.
 *
 * P0.4 imported the function-room app as-is. Parts of it still address tables
 * and columns that the current `public` schema does not have (`members`,
 * `login_history`, `push_subscriptions`, `profiles.member_id`,
 * `profiles.is_bar_staff`, `profiles.password_set`, `members.pending_role`,
 * and the `booker` value of `user_role`). Those call sites are outside P1.6's
 * scope — it moves the *booking* data layer onto the unified tables — and
 * "fixing" them here would change behaviour in features this task must leave
 * alone.
 *
 * So they keep the untyped client they have always had, named to say why. Use
 * {@link createAdminClient} for anything that exists in `Database`; reach for
 * this only for the legacy surface above, and delete each use as the schema
 * and the app are reconciled (Phase 4).
 */
export function createLegacyAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
