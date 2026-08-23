import { createLegacyAdminClient } from "@/lib/supabase/legacy";

export async function recordLogin(params: {
  userId: string;
  method: "password" | "magic_link";
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const admin = createLegacyAdminClient();
  await admin.from("login_history").insert({
    user_id: params.userId,
    method: params.method,
    ip_address: params.ipAddress ?? null,
    user_agent: params.userAgent ?? null,
  });
}
