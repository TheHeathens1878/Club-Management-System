"use server";

/**
 * Pitch bookings by team — every write (gap 3).
 *
 * All of it goes through the USER-SCOPED client. The database, not this file,
 * decides what may happen:
 *
 *   - `bookings_team_staff_insert` allows a coach exactly one shape of row —
 *     a pending `block`/`training` booking on a pitch, for a team they staff,
 *     booked as themselves. Anything else is a 42501.
 *   - `bookings_team_guard()` is a BEFORE trigger, so it runs ahead of the
 *     WITH CHECK. On INSERT it PINS a non-administrator's pitch booking to
 *     `pending` whatever this file posts (Adam, 2026-08-25: a coach's booking
 *     goes to an admin for approval), so the rule survives any client that
 *     talks to the API directly. On UPDATE it raises P0001 with the sentence
 *     the coach needs ("only a club administrator can confirm a pitch
 *     booking"). Those messages are passed through verbatim — rewriting them
 *     would throw away the only explanation the user gets.
 *   - `bookings_no_overlap`, the GiST exclusion constraint, is the single
 *     arbiter of whether a pitch is free. `booking_has_conflict()` is asked
 *     first so a clash can be named before anything is written, but the
 *     constraint is what makes it safe when two coaches submit at once — so
 *     23P01 is handled on every path that can create an overlap.
 *
 * A weekly repeat is written as one multi-row INSERT: Postgres makes that
 * atomic, so a series either lands whole or not at all. When the constraint
 * rejects it, each occurrence is re-checked so the message can say which week
 * clashed rather than "something clashed".
 */

import { revalidatePath } from "next/cache";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@club/db";

import {
  addDays,
  isValidDateString,
  isValidTimeString,
  localToInstant,
  normaliseTime,
} from "@/lib/booking-time";
import { isSlotConflict, slotHasConflict, SLOT_TAKEN_MESSAGE } from "@/lib/booking-conflict";
import { bookingPeriod, type BookingInsert } from "@/lib/booking-types";
import { friendlyDbError } from "@/lib/people-display";
import {
  formatInstantSlot,
  isOppositionSide,
  matchLabel,
  MAX_REPEAT_WEEKS,
  PITCH_BOOKING_KINDS,
  type OppositionSide,
  type PitchBookingKind,
} from "@/lib/pitch-booking";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { resolveRoleView } from "@/lib/role-view";
import { getSessionProfile } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PitchBookingActionState = {
  error?: string;
  notice?: string;
  /** Occurrences that already clash, in Europe/London wall clock. */
  clashes?: string[];
  /** Set on a successful create, so the form can link to the team page. */
  teamId?: string;
  /**
   * The match this booking belongs to, when a refusal is really "you want the
   * match, not the booking" (Adam, 2026-09-02). The screen turns it into a
   * link, because a sentence naming another page is only half an answer.
   */
  fixtureHref?: string;
};

const NOT_ALLOWED =
  "The database refused that. Pitch bookings can only be requested by a team's coach, assistant coach or manager, and only a club administrator can confirm one.";

const NO_PERSON =
  "Your sign-in is not linked to a member record yet, so the club cannot record who is booking. Ask a club administrator to link it.";

/**
 * Nothing changed and the database did not say why.
 *
 * An UPDATE policy's USING clause is a ROW FILTER: a caller the policy does not
 * admit updates zero rows and gets `error: null`, which reads exactly like a
 * success. `endMembership` and `changeMemberRole` handle it the same way — ask
 * for the rows back and treat "none" as the refusal it is.
 */
const CANCEL_REFUSED =
  "Nothing changed. Either that booking has already been cancelled, or it is not yours to cancel — a booking allocated to a fixture is unallocated by a club administrator on Pitches.";

/**
 * Is this person acting as a club administrator RIGHT NOW?
 *
 * Two questions, and both have to say yes. `is_club_admin()` is the database's
 * answer to what they may do; the role view is the hat they chose to wear, and
 * Adam, 2026-08-25: "I can still book a pitch as confirmed using my coach login
 * … remove this functionality." His sign-in is committee, which maps to
 * club_admin, so ROLE alone confirmed his bookings however he was signed in.
 *
 * Read here, in the action, and never taken from the form: the cookie is the
 * same one `/pitches/book` renders from, so the screen and the write cannot
 * disagree, and a hand-made POST carrying `status=confirmed` gets the hat this
 * browser is actually wearing rather than the one it claims.
 */
async function actingAsClubAdmin(): Promise<boolean> {
  const capabilities = await getCapabilities();
  if (!capabilities.isClubAdmin) return false;
  return resolveRoleView(await getStoredRoleView(), capabilities) === "admin";
}

type Occurrence = { startsAt: string; endsAt: string; label: string };

function revalidatePitchPaths(teamId?: string | null): void {
  revalidatePath("/pitches");
  revalidatePath("/pitches/mine");
  revalidatePath("/pitches/requests");
  if (teamId) revalidatePath(`/teams/${teamId}`);
  revalidatePath("/teams/[id]", "page");
}

function text(formData: FormData, key: string, max = 500): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

/**
 * The Europe/London window a form describes, as a pair of instants — repeated
 * weekly when asked for. A pitch session never runs past midnight, so an end
 * time at or before the start is a mistake, not an overnight booking.
 */
function readOccurrences(
  formData: FormData,
  allowRepeat: boolean,
): { occurrences: Occurrence[] } | { error: string } {
  const date = text(formData, "date", 10);
  const startRaw = text(formData, "start_time", 8);
  const endRaw = text(formData, "end_time", 8);

  if (!isValidDateString(date)) return { error: "Choose a date." };
  if (!isValidTimeString(startRaw) || !isValidTimeString(endRaw)) {
    return { error: "Choose a start and an end time." };
  }
  const startTime = normaliseTime(startRaw);
  const endTime = normaliseTime(endRaw);
  if (endTime <= startTime) {
    return { error: "The end time must be after the start time." };
  }

  let weeks = 1;
  if (allowRepeat) {
    const raw = text(formData, "repeat_weeks", 4);
    if (raw) {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_REPEAT_WEEKS) {
        return { error: `A weekly repeat must be between 1 and ${MAX_REPEAT_WEEKS} weeks.` };
      }
      weeks = parsed;
    }
  }

  const occurrences: Occurrence[] = [];
  for (let week = 0; week < weeks; week += 1) {
    const day = addDays(date, week * 7);
    const startsAt = localToInstant(day, startTime);
    const endsAt = localToInstant(day, endTime);
    occurrences.push({ startsAt, endsAt, label: formatInstantSlot(startsAt, endsAt) });
  }
  return { occurrences };
}

/**
 * Who the match is against, as the form put it.
 *
 * `opponentTeamId` is the only part the database keeps as data
 * (`bookings.opponent_team_id`, 20260825410000) and it is the thing
 * `create_internal_match_fixtures()` builds the away mirror from. It is set
 * for an internal opposition and nothing else: an external club has no team
 * row, and a training or block booking has no opposition at all — a CHECK
 * constraint refuses one, so the null here is not a nicety.
 */
type Opposition = {
  side: OppositionSide;
  /** Null unless this is a match against another of the club's own teams. */
  opponentTeamId: string | null;
  /** The free-typed name, which only an external opposition ever has. */
  opponentTyped: string;
};

function readOpposition(formData: FormData, kind: PitchBookingKind, teamId: string): Opposition {
  if (kind !== "fixture") return { side: "external", opponentTeamId: null, opponentTyped: "" };

  const posted = text(formData, "opponent_team_id", 40);
  const opponentTyped = text(formData, "opponent_name", 80);
  const sideRaw = text(formData, "opposition", 20);
  const side: OppositionSide = isOppositionSide(sideRaw)
    ? sideRaw
    : posted
      ? "internal"
      : "external";

  // A team cannot play itself — the form filters its own team out of the
  // select, and a hand-made POST is held to the same rule the database's
  // `bookings_opponent_team_not_self` CHECK would apply.
  const opponentTeamId = side === "internal" && posted && posted !== teamId ? posted : null;
  return { side, opponentTeamId, opponentTyped };
}

/**
 * The label the pitch diary will show, "U14 Mavericks v Sale Sharks" and all.
 *
 * Whatever was typed wins — Adam asked for a pre-filled label that is "still
 * editable", and a server that quietly rewrites it is not that. The fallback is
 * for the case the form's pre-fill never happened: no JavaScript, or a POST
 * made by hand. Filing a match under nothing but the team name is worse than
 * asking the database for two names.
 */
async function pitchBookingLabel(
  supabase: SupabaseClient<Database>,
  formData: FormData,
  kind: PitchBookingKind,
  teamId: string,
  opposition: Opposition,
): Promise<string | null> {
  const typed = text(formData, "occasion", 120);
  if (typed) return typed;
  if (kind !== "fixture") return null;

  const { side, opponentTeamId, opponentTyped } = opposition;

  // An internal opponent is named by the club, not by the form: the id is what
  // was posted, and the name comes from `teams` (readable by any member —
  // `teams_read`). A club from outside has no row anywhere, so what was typed
  // is all there is.
  const wantedIds = side === "internal" && opponentTeamId ? [teamId, opponentTeamId] : [teamId];
  const { data } = await supabase.from("teams").select("id,name").in("id", wantedIds);
  const nameById = new Map((data ?? []).map((row) => [row.id, row.name]));
  const opponent =
    side === "internal" ? (opponentTeamId ? (nameById.get(opponentTeamId) ?? null) : null) : opponentTyped;
  return matchLabel(nameById.get(teamId) ?? null, opponent) || null;
}

/**
 * An internal match becomes TWO fixture rows — one on each team's page.
 *
 * `fixtures.booking_id` and `bookings.fixture_id` are both UNIQUE, so the two
 * sides cannot both hold the pitch booking: the booking's own team is home and
 * keeps the link, the opposition gets the away mirror, and
 * `fixtures.mirror_fixture_id` joins them so a cancellation moves both.
 * `create_internal_match_fixtures()` (20260825410000) does all of it in one
 * transaction, is club_admin only, and is idempotent — a second click returns
 * the pair it already made rather than creating four rows — so this action
 * does not have to guard against being called twice.
 */
async function mirrorInternalMatch(
  supabase: SupabaseClient<Database>,
  bookingId: string,
): Promise<{ created: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("create_internal_match_fixtures", {
    p_booking_id: bookingId,
  });
  if (error) return { created: false, error: friendlyDbError(error, NOT_ALLOWED) };
  return { created: (data ?? []).length === 2 };
}

/** Every occurrence `booking_has_conflict()` says is already taken. */
async function findClashes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  resourceId: string,
  occurrences: Occurrence[],
  excludeBookingId?: string | null,
): Promise<string[]> {
  const results = await Promise.all(
    occurrences.map(async (occurrence) => ({
      label: occurrence.label,
      taken: await slotHasConflict(supabase, {
        resourceId,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        excludeBookingId: excludeBookingId ?? null,
      }),
    })),
  );
  return results.filter((r) => r.taken).map((r) => r.label);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createPitchBooking(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to request a pitch." };

  const teamId = text(formData, "team_id", 40);
  const resourceId = text(formData, "resource_id", 40);
  const kindRaw = text(formData, "kind", 20);

  if (!teamId) return { error: "Choose a team." };
  if (!resourceId) return { error: "Choose a pitch." };
  if (!PITCH_BOOKING_KINDS.includes(kindRaw as PitchBookingKind)) {
    return { error: "Choose what the pitch is for." };
  }
  const kind = kindRaw as PitchBookingKind;

  const window = readOccurrences(formData, kind === "training");
  if ("error" in window) return { error: window.error };
  const { occurrences } = window;

  const supabase = await createClient();
  const [personResult, adminResult, asAdmin] = await Promise.all([
    supabase.rpc("current_person_id"),
    supabase.rpc("is_club_admin"),
    actingAsClubAdmin(),
  ]);
  const personId = personResult.data ?? null;
  if (!personId) return { error: NO_PERSON };
  const isAdmin = adminResult.data === true;

  // A courtesy check only — `bookings_team_staff_insert` is the real gate, and
  // it is the one that runs whatever this says.
  if (!isAdmin) {
    const { data: staff } = await supabase.rpc("is_team_staff", { p_team_id: teamId });
    if (staff !== true) {
      return { error: "You are not listed as coach, assistant coach or manager of that team." };
    }
  }

  // Which PATH this booking takes, and it is the hat that decides — not the
  // role. Acting as a coach means `request_team_pitch_booking()`, which has no
  // status parameter at all and so cannot produce a confirmed booking for
  // anybody; acting as an administrator means the direct insert, where the
  // form's Save-as choice applies. `status` below is only what this action
  // then reports — the database has already had the final word either way.
  const wantsConfirmed = asAdmin && text(formData, "status", 20) === "confirmed";
  const status = wantsConfirmed ? "confirmed" : "pending";

  const clashes = await findClashes(supabase, resourceId, occurrences);
  if (clashes.length > 0) {
    return {
      error:
        occurrences.length === 1
          ? "That slot is already booked on that pitch. Choose a different time, date or pitch."
          : `${clashes.length} of the ${occurrences.length} sessions clash with a booking that is already on that pitch. Nothing has been saved.`,
      clashes,
    };
  }

  const bookerName = session.profile?.full_name?.trim() || session.email || "Club member";
  const bookerEmail = session.email?.trim();
  if (!bookerEmail) {
    return { error: "Your sign-in has no email address, and a booking must record a contact." };
  }

  const recurrenceGroupId = occurrences.length > 1 ? crypto.randomUUID() : null;
  const opposition = readOpposition(formData, kind, teamId);
  const occasion = await pitchBookingLabel(supabase, formData, kind, teamId, opposition);
  const notes = text(formData, "notes") || null;

  // Two paths, one for each hat, and the difference is which of them the
  // database will let confirm anything.
  //
  //   · Acting as a coach — `request_team_pitch_booking()`. One INSERT inside
  //     a function with no status parameter, so the row is pending whatever
  //     this file, this browser or a hand-made API call wants. RLS still runs
  //     (the function is `security invoker`), so a coach still only gets their
  //     own team's pitch.
  //   · Acting as a club administrator — the direct multi-row INSERT that
  //     screen has always used, carrying the Save-as choice.
  //
  // Both are a single statement: atomic, so a clashing week cannot leave half
  // a series behind, and the desk gets one notification for a whole repeat.
  let created: { id: string }[] | null = null;
  let error: PostgrestError | null = null;

  if (asAdmin) {
    const rows: BookingInsert[] = occurrences.map((occurrence) => ({
      resource_id: resourceId,
      team_id: teamId,
      kind,
      status,
      ...bookingPeriod(occurrence.startsAt, occurrence.endsAt),
      booker_person_id: personId,
      booker_profile_id: session.userId,
      booker_name: bookerName,
      booker_email: bookerEmail,
      occasion,
      notes,
      recurrence_group_id: recurrenceGroupId,
      opponent_team_id: opposition.opponentTeamId,
    }));
    const result = await supabase.from("bookings").insert(rows).select("id");
    created = result.data;
    error = result.error;
  } else {
    const result = await supabase.rpc("request_team_pitch_booking", {
      p_team_id: teamId,
      p_resource_id: resourceId,
      p_kind: kind,
      p_starts: occurrences.map((occurrence) => occurrence.startsAt),
      p_ends: occurrences.map((occurrence) => occurrence.endsAt),
      p_booker_name: bookerName,
      p_booker_email: bookerEmail,
      p_occasion: occasion,
      p_notes: notes,
      p_recurrence_group_id: recurrenceGroupId,
      p_opponent_team_id: opposition.opponentTeamId,
    });
    created = (result.data ?? []).map((row) => ({ id: row.booking_id }));
    error = result.error;
  }

  if (error) {
    if (isSlotConflict(error)) {
      const late = await findClashes(supabase, resourceId, occurrences);
      return {
        error:
          late.length > 0
            ? "Someone booked that pitch while this form was open. Nothing has been saved."
            : "That pitch was taken while this form was open. Nothing has been saved.",
        clashes: late.length > 0 ? late : occurrences.map((o) => o.label),
      };
    }
    return { error: friendlyDbError(error, NOT_ALLOWED) };
  }

  const bookingIds = (created ?? []).map((row) => row.id);

  // Extra teams sharing the session. The owning team is on the booking, so it
  // is never repeated here.
  const extraTeamIds = Array.from(
    new Set(
      formData
        .getAll("extra_team_ids")
        .map((value) => String(value).trim())
        .filter((value) => value !== "" && value !== teamId),
    ),
  );
  let sharingWarning = "";
  if (extraTeamIds.length > 0 && bookingIds.length > 0) {
    const links = bookingIds.flatMap((bookingId) =>
      extraTeamIds.map((extraTeamId) => ({ booking_id: bookingId, team_id: extraTeamId })),
    );
    const { error: shareError } = await supabase.from("booking_teams").insert(links);
    if (shareError) {
      sharingWarning = ` The sharing teams could not be added: ${friendlyDbError(shareError, NOT_ALLOWED)}`;
    }
  }

  // An internal match that is already CONFIRMED gets its two fixtures now —
  // this is an administrator booking as an administrator, which is the same
  // decision the requests desk makes, just made a step earlier. A request lands
  // pending and gets nothing yet, by design: a pending slot must not put a game
  // on the opposition's matchday tab.
  let matchNotice = "";
  const matchBookingId = bookingIds.length === 1 ? bookingIds[0] : undefined;
  if (status === "confirmed" && opposition.opponentTeamId && matchBookingId) {
    const mirrored = await mirrorInternalMatch(supabase, matchBookingId);
    matchNotice = mirrored.error
      ? ` The booking is saved, but the fixtures could not be created: ${mirrored.error}`
      : " The fixture is on both teams' pages.";
    revalidatePath(`/teams/${opposition.opponentTeamId}`);
  } else if (opposition.opponentTeamId) {
    matchNotice = " Once it is confirmed, the fixture appears on both teams' pages.";
  }

  revalidatePitchPaths(teamId);
  for (const extraTeamId of extraTeamIds) revalidatePath(`/teams/${extraTeamId}`);

  const what =
    occurrences.length === 1 ? "Pitch booking" : `${occurrences.length} weekly pitch sessions`;
  // Said the way it actually happened. A coach — an administrator wearing the
  // Coach hat included — has made a REQUEST, and telling them it is "confirmed"
  // when the row says `pending` is the bug Adam reported.
  const outcome =
    status === "confirmed"
      ? `${what} confirmed.`
      : asAdmin
        ? `${what} saved as pending. It is on the requests desk for a decision.`
        : `${what} requested. It has gone to a club administrator for approval — the slot is held for you and you will be told when it is decided.`;

  return { notice: `${outcome}${matchNotice}${sharingWarning}`, teamId };
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * Cancelling is a status change, never a delete: the row is the history the
 * calendar and the audit trail read. `bookings_team_guard()` lets a coach make
 * exactly this change on their own team's booking — pending or confirmed —
 * which is Adam's "allow coaches to cancel bookings", 2026-08-25.
 *
 * The refusal is passed through verbatim when the trigger raises one (a
 * fixture's allocated slot, an already-cancelled row), because the trigger's
 * sentence names what to do next and this file's would not. When RLS refuses
 * instead there IS no sentence — the USING clause filters the row out, the
 * update touches nothing and comes back clean — so the rows are asked for and
 * "none" is reported as the refusal it is.
 */
export async function cancelPitchBooking(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const bookingId = text(formData, "booking_id", 40);
  if (!bookingId) return { error: "No booking given." };
  const teamId = text(formData, "team_id", 40) || null;

  const supabase = await createClient();
  // Read first, so the notice can say what actually happened. An internal
  // match's booking IS the match: `bookings_cancel_internal_match()` and
  // `fixtures_cancel_mirror()` cancel BOTH fixture rows in the same
  // transaction as the update below, and a "the pitch is free again" that says
  // nothing about the game would be the smaller half of the truth.
  const { data: before } = await supabase
    .from("bookings")
    .select("opponent_team_id,fixture_id")
    .eq("id", bookingId)
    .maybeSingle();
  const wasInternalMatch = Boolean(before?.opponent_team_id && before?.fixture_id);

  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .neq("status", "cancelled")
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if (!data || data.length === 0) return { error: CANCEL_REFUSED };

  revalidatePitchPaths(teamId);
  if (before?.opponent_team_id) revalidatePath(`/teams/${before.opponent_team_id}`);
  return {
    notice: wasInternalMatch
      ? "Match cancelled. It is off both teams' pages and the pitch is free again."
      : "Booking cancelled. The pitch is free again.",
  };
}

/** The whole weekly series, for a repeat that should not have been made. */
export async function cancelPitchBookingSeries(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const groupId = text(formData, "recurrence_group_id", 40);
  if (!groupId) return { error: "That booking is not part of a weekly series." };
  const teamId = text(formData, "team_id", 40) || null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("recurrence_group_id", groupId)
    .gte("ends_at", new Date().toISOString())
    .neq("status", "cancelled")
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if (!data || data.length === 0) {
    return {
      error:
        "Nothing changed. Either the rest of that series has already been cancelled, or it is not yours to cancel.",
    };
  }

  revalidatePitchPaths(teamId);
  return {
    notice:
      data.length === 1
        ? "The remaining session in that series is cancelled."
        : `The remaining ${data.length} sessions in that series are cancelled.`,
  };
}

// ---------------------------------------------------------------------------
// Edit — pending bookings only, which the trigger also enforces
// ---------------------------------------------------------------------------

export async function updatePitchBooking(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const bookingId = text(formData, "booking_id", 40);
  if (!bookingId) return { error: "No booking given." };
  const resourceId = text(formData, "resource_id", 40);
  if (!resourceId) return { error: "Choose a pitch." };
  const teamId = text(formData, "team_id", 40) || null;

  const window = readOccurrences(formData, false);
  if ("error" in window) return { error: window.error };
  const occurrence = window.occurrences[0];
  if (!occurrence) return { error: "Choose a date and a time." };

  const supabase = await createClient();
  const clashes = await findClashes(supabase, resourceId, [occurrence], bookingId);
  if (clashes.length > 0) {
    return {
      error: "That slot is already booked on that pitch. Choose a different time, date or pitch.",
      clashes,
    };
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      resource_id: resourceId,
      ...bookingPeriod(occurrence.startsAt, occurrence.endsAt),
      occasion: text(formData, "occasion", 120) || null,
      notes: text(formData, "notes") || null,
    })
    .eq("id", bookingId);

  if (error) {
    if (isSlotConflict(error)) {
      return { error: SLOT_TAKEN_MESSAGE, clashes: [occurrence.label] };
    }
    return { error: friendlyDbError(error, NOT_ALLOWED) };
  }

  revalidatePitchPaths(teamId);
  return { notice: "Booking updated." };
}

// ---------------------------------------------------------------------------
// The administrator's desk
// ---------------------------------------------------------------------------

/**
 * Confirming brings a pending row under `bookings_no_overlap` against every
 * other live booking, so this update can collide even though the request was
 * accepted — hence `conflictOrMessage`.
 *
 * Confirming is also the moment an INTERNAL match becomes two fixtures, one on
 * each team's page (Adam, 2026-08-26). Not a moment earlier: a pending request
 * on two teams' matchday tabs would have the opposition's coach asking for
 * availability against a game nobody has agreed to. The fixtures are created
 * only after the status update has actually landed — the RPC refuses a booking
 * that is not confirmed, so the order here is the same rule said twice.
 */
export async function confirmPitchBooking(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const bookingId = text(formData, "booking_id", 40);
  if (!bookingId) return { error: "No booking given." };
  const teamId = text(formData, "team_id", 40) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("bookings")
    .update({ status: "confirmed" })
    .eq("id", bookingId);
  if (error) {
    if (isSlotConflict(error)) return { error: SLOT_TAKEN_MESSAGE };
    return { error: friendlyDbError(error, NOT_ALLOWED) };
  }

  // Only a match against another of the club's OWN teams has a second page to
  // appear on. An external opponent has no team row, creates no fixture today
  // and creates none now.
  const { data: booking } = await supabase
    .from("bookings")
    .select("kind,opponent_team_id")
    .eq("id", bookingId)
    .maybeSingle();

  let matchNotice = "";
  if (booking?.kind === "fixture" && booking.opponent_team_id) {
    const mirrored = await mirrorInternalMatch(supabase, bookingId);
    matchNotice = mirrored.error
      ? ` The pitch is booked, but the fixtures could not be created: ${mirrored.error}`
      : " The fixture is on both teams' pages.";
    revalidatePath(`/teams/${booking.opponent_team_id}`);
  }

  revalidatePitchPaths(teamId);
  return { notice: `Confirmed.${matchNotice || " The pitch is theirs."}` };
}

/** Declining is a cancellation with the reason kept where staff can read it. */
export async function declinePitchBooking(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const bookingId = text(formData, "booking_id", 40);
  if (!bookingId) return { error: "No booking given." };
  const teamId = text(formData, "team_id", 40) || null;
  const reason = text(formData, "reason");
  if (!reason) return { error: "Say why it is being declined — the coach is told this." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("bookings")
    .select("internal_notes")
    .eq("id", bookingId)
    .maybeSingle();

  const stamped = `Declined ${new Date().toISOString().slice(0, 10)}: ${reason}`;
  const internalNotes = existing?.internal_notes
    ? `${existing.internal_notes}\n${stamped}`
    : stamped;

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", internal_notes: internalNotes })
    .eq("id", bookingId);
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidatePitchPaths(teamId);
  return { notice: "Request declined." };
}

/**
 * Delete a pitch booking outright — the legacy app's "Delete booking".
 * Administrators only, never a fixture's slot (unallocate that on /pitches so
 * the fixture keeps its state), and audited like the room-booking deletes.
 * Cancelling remains the everyday path; deletion is for entries that should
 * never have existed.
 */
export async function deletePitchBooking(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const bookingId = text(formData, "booking_id", 40);
  if (!bookingId) return { error: "No booking given." };
  const teamId = text(formData, "team_id", 40) || null;

  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again first." };
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_club_admin");
  if (isAdmin !== true) return { error: "Only a club administrator can delete a booking." };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("bookings")
    .select("id,kind,fixture_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!existing) return { error: "That booking no longer exists." };

  // A fixture's slot is not a booking anybody should delete: the fixture would
  // keep pointing at a row that no longer exists, or — worse, since
  // `bookings.fixture_id` is ON DELETE SET NULL the other way round — the
  // fixture would still be there with nowhere to play.
  //
  // Adam, 2026-09-02: "I can't delete a match which is flagged as not being in
  // full-time. I try and delete from the bookings calendar but comes up with
  // [this message]." He was not trying to delete a booking; he was trying to
  // delete a MATCH, from the only screen he had it on. Refusing was right and
  // the sentence was useless — it named a screen, not the two things he could
  // actually do. So it now names both, and the caller shows the second as a
  // link straight to the match.
  if (existing.kind === "fixture" || existing.fixture_id) {
    const { data: fixture } = existing.fixture_id
      ? await admin
          .from("fixtures")
          .select("id,team_id")
          .eq("id", existing.fixture_id)
          .maybeSingle()
      : { data: null };
    return {
      error:
        "This slot belongs to a match, so deleting the booking on its own would leave the match with nowhere to play. Free the pitch by unallocating the match on Pitches — or, if the match itself is off, cancel or delete it on the match, which gives the pitch back at the same time.",
      fixtureHref:
        fixture?.team_id && fixture.id
          ? `/teams/${fixture.team_id}/fixtures/${fixture.id}`
          : undefined,
    };
  }

  const { error } = await admin.from("bookings").delete().eq("id", bookingId);
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "delete",
    entity: "pitch_booking",
    entityId: bookingId,
  });

  revalidatePitchPaths(teamId);
  return { notice: "Booking deleted." };
}
