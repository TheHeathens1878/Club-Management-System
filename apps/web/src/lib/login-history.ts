import { createAdminClient } from "@/lib/supabase/admin";

export async function recordLogin(params: {
  userId: string;
  method: "password" | "magic_link";
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const admin = createAdminClient();
  await admin.from("login_history").insert({
    user_id: params.userId,
    method: params.method,
    ip_address: params.ipAddress ?? null,
    user_agent: params.userAgent ?? null,
  });
}
