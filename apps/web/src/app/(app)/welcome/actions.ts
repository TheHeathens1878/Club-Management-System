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
import { tidyRpcMessage } from "@/lib/waiting-list";

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
  // Adam, 2026-08-25: "if I select parent from the drop down, I think it
  // should just go to the team page for that child", and likewise "selecting
  // the coach role … should just take you straight to the chosen team page" —
  // any team-scoped pick lands on the team, not on a list of teams.
  if (team && (view === "parent" || view === "player" || view === "coach")) {
    redirect(`/teams/${team.id}`);
  }
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

/**
 * Asking to coach or to referee, after sign-up.
 *
 * Adam, 2026-09-02: "we also need the ability for users to request to become a
 * coach (selecting the team they coach) and a referee AFTER sign up."
 *
 * The joining form asks these two on its first step, which is fine for someone
 * arriving today and no use at all to the several hundred people already here.
 * Same question, same queue, same function: `request_role_for()`
 * (20260901200000) lands a PENDING row that /approvals decides. Nothing is
 * granted by asking.
 *
 * PLAYER AND PARENT ARE STILL NOT HERE. The docstring at the top of this file
 * says why creating account requests was removed in the first place — a player
 * or a parent is attached through registration, and a queue for them only
 * duplicated it. That reasoning is untouched: coach and referee are the two
 * hats registration has never had a way to ask for.
 */
export async function requestClubRole(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const role = String(formData.get("role") ?? "").trim();
  if (role !== "coach" && role !== "referee") return { error: "Choose coach or referee." };
  const teamId = String(formData.get("team_id") ?? "").trim();

  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");
  if (!personId) {
    return { error: "Your account is not linked to a member record yet — ask the club." };
  }

  const { data, error } = await supabase.rpc("request_role_for", {
    p_person_id: personId,
    p_role: role,
    ...(role === "coach" && teamId ? { p_team_id: teamId } : {}),
  });
  if (error) {
    // The referee age guard names the date somebody may ask on. That sentence
    // is the answer; summarising it would throw the date away.
    return { error: tidyRpcMessage(error.message) };
  }
  if (!data) {
    return {
      notice:
        role === "coach"
          ? "You already hold the coach hat at the club."
          : "You are already a referee at the club.",
    };
  }

  revalidatePath(PATH);
  return {
    notice:
      role === "coach"
        ? "Asked. A club administrator will confirm it."
        : "Asked. A club administrator will confirm it and add you to the referees group.",
  };
}
