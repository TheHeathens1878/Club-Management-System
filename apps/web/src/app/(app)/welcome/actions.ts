"use server";

/**
 * The login tiles.
 *
 * Two writes used to live here; one of them has gone. There is no longer any
 * way to CREATE an `account_requests` row from the app: a player or a parent
 * is attached to a team through the club's registration forms, and asking for
 * it in here only ever produced a queue that duplicated them. What remains:
 *
 *   · `setRoleView` stores which of the club's five kinds of user this person
 *     is looking at the app as. It grants nothing and touches no table — but it
 *     is still checked against the database's own answer before it is written,
 *     so a hand-rolled POST cannot park an unqualified view in the cookie.
 *   · `withdrawAccountRequest` writes `account_requests` through the
 *     user-scoped client. The self-withdraw policy only lets a pending row of
 *     one's own become `withdrawn`. Requests made before this change still show
 *     on /welcome read-only, and this is how someone takes one back.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getCapabilities } from "@/lib/capabilities";
import {
  ROLE_VIEW_COOKIE,
  ROLE_VIEW_HOME,
  ROLE_VIEW_PROMPTED_COOKIE,
  TEAM_SCOPE_COOKIE,
  isRoleView,
  parseViewOption,
  qualifiesForView,
  teamsForView,
  type RoleView,
} from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";

const PATH = "/welcome";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Pick a tile: store the view and land on that view's own home screen.
 * A view the database does not back is refused outright — this is the only
 * writer of the cookie, so an unqualified value can never get into it.
 */
export async function setRoleView(view: RoleView, teamId?: string): Promise<void> {
  if (!isRoleView(view)) return;
  const capabilities = await getCapabilities();
  if (!qualifiesForView(view, capabilities)) return;

  // A team narrows the view only when that view actually holds it — a made-up
  // id is dropped rather than stored, so the scope cookie can never name a
  // team the switcher would not have offered.
  const team = teamId ? teamsForView(view, capabilities).find((t) => t.id === teamId) : undefined;

  const store = await cookies();
  store.set(ROLE_VIEW_COOKIE, view, {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    httpOnly: false,
  });
  if (team) {
    store.set(TEAM_SCOPE_COOKIE, team.id, {
      path: "/",
      maxAge: ONE_YEAR,
      sameSite: "lax",
      httpOnly: false,
    });
  } else {
    store.delete(TEAM_SCOPE_COOKIE);
  }
  // Once they have chosen, the first-visit nudge has done its job.
  store.set(ROLE_VIEW_PROMPTED_COOKIE, "1", {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    httpOnly: false,
  });

  revalidatePath("/", "layout");
  redirect(ROLE_VIEW_HOME[view]);
}

/**
 * The "Viewing as" dropdown's writer: one serialized option ("admin",
 * "coach:<teamId>", …) straight from `roleViewOptions()`. Everything is
 * re-validated in `setRoleView` — the dropdown is the convenience, not the
 * authority.
 */
export async function switchRoleView(value: string): Promise<void> {
  const parsed = parseViewOption(value);
  if (!parsed) return;
  await setRoleView(parsed.view, parsed.teamId ?? undefined);
}

export type RequestState = { error?: string; notice?: string };

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
