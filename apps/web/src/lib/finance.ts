import { redirect } from "next/navigation";

import { getCapabilities } from "@/lib/capabilities";
import { getSessionProfile } from "@/lib/auth";

export * from "@/lib/finance-format";

/**
 * The finance section's one guard (Adam, 2026-09-04: "we will need a
 * dedicated finance user"). `hasFinanceRole` is the DB's `is_finance()` —
 * true for the `finance` person-role and for club_admin — so the page gate
 * mirrors the RLS gate exactly: the nav offers what the policies will honour.
 *
 * Server-only (it reads the session); client components import the pure
 * formatters from @/lib/finance-format instead.
 */
export async function requireFinance() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const capabilities = await getCapabilities();
  if (!capabilities.hasFinanceRole) redirect("/overview");
  return { session, capabilities };
}
