import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * An in-app notification to everyone who works the room desk — bar staff,
 * committee and the super user — about a room booking (Adam, 2026-09-12:
 * "I want room bookings to show in admin notifications"). One row per person
 * through `notify()`, which is service-role-only, so this takes the admin
 * client. A person with no `people` row gets nothing: the feed is keyed by
 * person, and `notify()` answers null for a null id.
 *
 * Never lets a failure out: a booking that was saved and paid for is not
 * un-saved because a bell could not be rung.
 */
export async function notifyRoomDesk(
  admin: AdminClient,
  input: { subject: string; body: string; bookingId: string },
): Promise<void> {
  try {
    const { data: staff } = await admin
      .from("profiles")
      .select("person_id")
      .in("role", ["bar", "committee", "super_user"])
      .not("person_id", "is", null);
    const personIds = [...new Set((staff ?? []).map((row) => row.person_id).filter((id): id is string => !!id))];
    await Promise.all(
      personIds.map((personId) =>
        admin.rpc("notify", {
          p_person_id: personId,
          p_subject: input.subject,
          p_body: input.body,
          p_link: `/room-bookings/${input.bookingId}`,
          p_entity: "bookings",
          p_entity_id: input.bookingId,
        }),
      ),
    );
  } catch (e) {
    console.error("[room-desk] notification not sent:", e);
  }
}
