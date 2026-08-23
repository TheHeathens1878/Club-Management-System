"use server";

/**
 * Pitch allocation (PLAN.md P2.5).
 *
 * There is deliberately no allocation logic here. `allocate_fixture()` and
 * `unallocate_fixture()` are SECURITY DEFINER functions that create or move the
 * linked `kind = 'fixture'` booking through the ordinary insert/update path, so
 * the `bookings_no_overlap` exclusion constraint stays the single arbiter of
 * whether a pitch is free — the same arbiter a function-room hire meets. This
 * file only checks the caller is committee, calls the function, and hands the
 * database's own answer back to the screen.
 *
 * Conflicts matter more than most errors, so they are passed through verbatim:
 * the function raises SQLSTATE 23P01 with the clashing bookings named
 * ("Hirer 16/09 11:00–13:00 (hire)"), which is exactly what an admin needs in
 * order to decide between another pitch and another kick-off time.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";

/** SQLSTATE for `exclusion_violation` — the named-conflict case. */
const CONFLICT_SQLSTATE = "23P01";

export type AllocationResult = {
  error?: string;
  /** True when the error is a named pitch clash rather than a fault. */
  conflict?: boolean;
};

export type AllocateInput = {
  fixtureId: string;
  resourceId: string;
  /** Blank means "use the pitch's default". */
  preBufferMinutes?: number | null;
  postBufferMinutes?: number | null;
};

async function requireCommittee() {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) redirect("/room-bookings");
  return session;
}

/** The pitch screen and every screen that shows where a fixture is played. */
function revalidateAllocation() {
  revalidatePath("/pitches");
  revalidatePath("/room-bookings");
  revalidatePath("/teams/[id]", "page");
}

function buffer(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

/**
 * Put a home fixture on a pitch, or move one already allocated.
 *
 * Both are the same call: `allocate_fixture()` creates the booking the first
 * time and moves the existing one afterwards, so "Allocate" and "Move to…" do
 * not drift apart.
 */
export async function allocateFixture(input: AllocateInput): Promise<AllocationResult> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  if (!input.resourceId) return { error: "Choose a pitch first." };

  const { data: before } = await admin
    .from("fixtures")
    .select("id,venue_resource_id,booking_id")
    .eq("id", input.fixtureId)
    .maybeSingle();

  const { data, error } = await admin.rpc("allocate_fixture", {
    p_fixture_id: input.fixtureId,
    p_resource_id: input.resourceId,
    p_pre_buffer_minutes: buffer(input.preBufferMinutes),
    p_post_buffer_minutes: buffer(input.postBufferMinutes),
  });

  if (error) {
    // Verbatim: the message names the bookings in the way. Anything else is a
    // fault the admin cannot act on, so it is reported plainly too.
    return { error: error.message, conflict: error.code === CONFLICT_SQLSTATE };
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: before?.booking_id ? "reallocate" : "allocate",
    entity: "fixture",
    entityId: input.fixtureId,
    detail: {
      resource_id: input.resourceId,
      previous_resource_id: before?.venue_resource_id ?? null,
      booking_id: data,
      pre_buffer_minutes: buffer(input.preBufferMinutes) ?? null,
      post_buffer_minutes: buffer(input.postBufferMinutes) ?? null,
    },
  });

  revalidateAllocation();
  return {};
}

/** Take a fixture off its pitch. The booking is cancelled, not deleted. */
export async function unallocateFixture(fixtureId: string): Promise<AllocationResult> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  const { data: before } = await admin
    .from("fixtures")
    .select("id,venue_resource_id,booking_id")
    .eq("id", fixtureId)
    .maybeSingle();

  const { error } = await admin.rpc("unallocate_fixture", { p_fixture_id: fixtureId });
  if (error) return { error: error.message, conflict: error.code === CONFLICT_SQLSTATE };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "unallocate",
    entity: "fixture",
    entityId: fixtureId,
    detail: {
      previous_resource_id: before?.venue_resource_id ?? null,
      previous_booking_id: before?.booking_id ?? null,
    },
  });

  revalidateAllocation();
  return {};
}
