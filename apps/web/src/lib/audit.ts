import type { Json } from "@club/db";

import { createAdminClient } from "@/lib/supabase/admin";

export async function writeAudit(params: {
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: Json;
}) {
  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    actor_id: params.actorId,
    actor_email: params.actorEmail,
    action: params.action,
    entity: params.entity,
    entity_id: params.entityId ?? null,
    detail: params.detail ?? null,
  });
}
