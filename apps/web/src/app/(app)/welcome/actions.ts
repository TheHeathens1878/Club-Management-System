"use server";

/**
 * The first-login role tiles (gap 4).
 *
 * Two quite different writes live here:
 *
 *   · `setRoleView` stores a *presentation preference* in a cookie. It grants
 *     nothing, so it needs no authorisation and touches no table.
 *   · `createAccountRequest` / `withdrawAccountRequest` write
 *     `account_requests` through the user-scoped client. The self-insert
 *     policy requires `person_id = current_person_id()`, and the self-withdraw
 *     policy only lets a pending row of one's own become `withdrawn`. Nothing
 *     here decides who becomes a coach — `approve_account_request()` does, and
 *     the SG-6 guard sits underneath it.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { isRequestedRole, requiresTeam } from "@/lib/account-requests";
import { getCurrentPersonId } from "@/lib/person";
import { ROLE_VIEW_COOKIE, ROLE_VIEW_PROMPTED_COOKIE, isRoleView, type RoleView } from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";

const PATH = "/welcome";
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setRoleView(view: RoleView): Promise<void> {
  if (!isRoleView(view)) return;
  const store = await cookies();
  store.set(ROLE_VIEW_COOKIE, view, {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    httpOnly: false,
  });
  // Once they have chosen, the first-visit nudge has done its job.
  store.set(ROLE_VIEW_PROMPTED_COOKIE, "1", {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    httpOnly: false,
  });
  revalidatePath("/", "layout");
}

export type RequestState = { error?: string; notice?: string };

export async function createAccountRequest(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const role = String(formData.get("requested_role") ?? "").trim();
  const teamId = String(formData.get("team_id") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  if (!isRequestedRole(role)) return { error: "Choose what you are asking for." };
  if (requiresTeam(role) && !teamId) return { error: "Choose a team." };

  const personId = await getCurrentPersonId();
  if (!personId) {
    return {
      error:
        "Your sign-in is not linked to a member record yet, so a request cannot be attributed. Please contact the club.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("account_requests").insert({
    person_id: personId,
    requested_role: role,
    team_id: requiresTeam(role) ? teamId : null,
    message: message || null,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "You already have a request waiting for that role — a club administrator will get to it." };
    }
    if (error.code === "42501") {
      return { error: "A request can only be made for your own account." };
    }
    // A database rule that refuses in terms (P0001) is quoted as it stands.
    return { error: error.message };
  }

  revalidatePath(PATH);
  return { notice: "Request sent. A club administrator will review it." };
}

export async function withdrawAccountRequest(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const id = String(formData.get("request_id") ?? "").trim();
  if (!id) return { error: "Missing request." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("account_requests")
    .update({ status: "withdrawn" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Only your own request, and only while it is still waiting, can be withdrawn."
          : error.message,
    };
  }
  if ((data ?? []).length === 0) {
    return { error: "That request has already been decided or withdrawn." };
  }

  revalidatePath(PATH);
  return { notice: "Request withdrawn." };
}
