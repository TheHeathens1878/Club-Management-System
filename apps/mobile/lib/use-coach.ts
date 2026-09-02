import type { Enums } from "@club/db";
import { useCallback, useEffect, useState } from "react";

import {
  parseStaffTeams,
  toCoachFixtures,
  toRegister,
  toSquadSheet,
  type CoachFixture,
  type EventPersonRow,
  type MatchdayRow,
  type RegisterRow,
  type SquadSheet,
  type StaffTeam,
} from "./coach";
import { clubDateTime } from "./format";
import { instantToLocal, isValidDateString, isValidTimeString, localToInstant } from "./london-time";
import type { SessionRow } from "./sessions";
import { getSupabase } from "./supabase";

/**
 * The coach's data, all of it through the caller's own client: every answer
 * is the one RLS and the SECURITY DEFINER accessors give THIS person, and
 * every write is one their policies allow. See lib/coach.ts for the shaping.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** How far ahead the coach's list looks — the web matches desk's "next 4 weeks". */
const FIXTURE_HORIZON_DAYS = 28;
/** Training registers: tonight's session back to yesterday's, two weeks ahead. */
const REGISTER_LOOKBACK_MS = 36 * HOUR_MS;
const REGISTER_HORIZON_DAYS = 14;

export function useStaffTeams(): { teams: StaffTeam[]; loading: boolean } {
  const [teams, setTeams] = useState<StaffTeam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await getSupabase().rpc("my_capabilities");
      if (!active) return;
      setTeams(parseStaffTeams(data));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { teams, loading };
}

export interface CoachSession {
  bookingId: string;
  title: string;
  when: string;
  resourceName: string;
  teamIds: string[];
}

export interface CoachDeskState {
  fixtures: CoachFixture[];
  sessions: CoachSession[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

/** The desk: upcoming games and training for the teams this person coaches. */
export function useCoachDesk(teams: StaffTeam[]): CoachDeskState {
  const [fixtures, setFixtures] = useState<CoachFixture[]>([]);
  const [sessions, setSessions] = useState<CoachSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setNonce((value) => value + 1);
  }, []);

  const teamKey = teams.map((team) => team.id).join(",");

  useEffect(() => {
    if (teamKey.length === 0) {
      setFixtures([]);
      setSessions([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let active = true;
    const supabase = getSupabase();
    const staffIds = new Set(teamKey.split(","));

    void (async () => {
      try {
        const now = Date.now();
        const [matchday, calendar] = await Promise.all([
          supabase.rpc("matchday_fixtures", {
            p_from: new Date(now - 2 * HOUR_MS).toISOString(),
            p_to: new Date(now + FIXTURE_HORIZON_DAYS * DAY_MS).toISOString(),
          }),
          supabase.rpc("pitch_calendar", {
            p_from: new Date(now - REGISTER_LOOKBACK_MS).toISOString(),
            p_to: new Date(now + REGISTER_HORIZON_DAYS * DAY_MS).toISOString(),
          }),
        ]);
        if (matchday.error) throw matchday.error;
        if (calendar.error) throw calendar.error;
        if (!active) return;

        setFixtures(toCoachFixtures((matchday.data ?? []) as unknown as MatchdayRow[], staffIds));

        const trainings = ((calendar.data ?? []) as unknown as SessionRow[])
          .filter((row) => row.kind === "training" && row.status !== "cancelled")
          .map((row) => ({
            row,
            ids: [row.team_id, ...(row.shared_team_ids ?? [])].filter(
              (id): id is string => !!id,
            ),
          }))
          .filter(({ ids }) => ids.some((id) => staffIds.has(id)))
          .map<CoachSession>(({ row, ids }) => ({
            bookingId: row.booking_id,
            title: row.label ?? row.team_name ?? "Training",
            when: clubDateTime(row.starts_at),
            resourceName: row.resource_name,
            teamIds: ids,
          }));
        setSessions(trainings);
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Could not load your teams' games.");
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [teamKey, nonce]);

  return { fixtures, sessions, loading, refreshing, error, refresh };
}

export interface SquadState {
  sheet: SquadSheet | null;
  /** The roster was refused — this person is not this game's to see. */
  hidden: boolean;
  loading: boolean;
  refresh: () => void;
}

/** One game's squad sheet. A refusal (P0001) renders as a note, not a crash. */
export function useSquadSheet(eventId: string | null): SquadState {
  const [sheet, setSheet] = useState<SquadSheet | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    let active = true;
    void (async () => {
      const { data, error } = await getSupabase().rpc("event_people", { p_event_id: eventId });
      if (!active) return;
      if (error) {
        setHidden(true);
        setSheet(null);
      } else {
        setHidden(false);
        setSheet(toSquadSheet((data ?? []) as unknown as EventPersonRow[]));
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [eventId, nonce]);

  return { sheet, hidden, loading, refresh };
}

export interface KickoffState {
  saving: boolean;
  error: string | null;
  notice: string | null;
  save: (fixtureId: string, date: string, time: string) => Promise<boolean>;
}

/**
 * Moving one game's kick-off — the same shape as the web fixture page's
 * editor, and the same authority: the update goes through the caller's own
 * client and `fixtures_staff_update` (staff of the team, or a club admin)
 * decides. The database then moves the pitch booking, rewrites the diary
 * entry and notifies everyone (`fixtures_sync_booking`,
 * `fixtures_events_sync_update`); where the new slot clashes it leaves the
 * booking put and says so, which is why the notice distinguishes the two.
 */
export function useKickoff(onSaved: () => void): KickoffState {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = useCallback(
    async (fixtureId: string, date: string, time: string): Promise<boolean> => {
      setError(null);
      setNotice(null);
      if (!isValidDateString(date)) {
        setError("Give the date as YYYY-MM-DD.");
        return false;
      }
      if (!isValidTimeString(time)) {
        setError("Give the kick-off as a time like 10:30.");
        return false;
      }

      setSaving(true);
      try {
        const supabase = getSupabase();
        const kickoffAt = localToInstant(date, time);
        const { data, error: updateError } = await supabase
          .from("fixtures")
          .update({ kickoff_at: kickoffAt })
          .eq("id", fixtureId)
          .select("id,allocation_conflict");
        if (updateError) throw updateError;
        if ((data ?? []).length === 0) {
          setError("Only this team's staff or a club administrator can move a kick-off.");
          return false;
        }

        // The same audit row the web editor writes, stamped with the caller
        // by `write_audit()` itself.
        await supabase.rpc("write_audit", {
          p_action: "fixture.kickoff_changed",
          p_entity: "fixtures",
          p_entity_id: fixtureId,
          p_detail: { to: kickoffAt, via: "mobile" },
        });

        setNotice(
          data?.[0]?.allocation_conflict === true
            ? "Kick-off moved — but the pitch booking could not follow it, because something else is on that slot. Sort the clash on Pitches (web)."
            : "Kick-off moved. The pitch booking, the diary entry and everybody's notifications follow it.",
        );
        onSaved();
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The database refused that kick-off.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [onSaved],
  );

  return { saving, error, notice, save };
}

/** The stored kick-off as London date and time, for prefilling the editor. */
export function kickoffFields(kickoffAt: string): { date: string; time: string } {
  return instantToLocal(kickoffAt);
}

export interface RegisterState {
  rows: RegisterRow[];
  loading: boolean;
  error: string | null;
  /** Set while a mark is in flight, keyed by person id. */
  saving: string | null;
  mark: (personId: string, status: Enums<"attendance_status">) => Promise<void>;
}

/**
 * The training register: the session's players with whatever is already
 * marked. Names come one at a time through `display_name()` — the accessor
 * that answers only for people this caller is entitled to name — because a
 * coach has no blanket read of `people`.
 */
export function useRegister(bookingId: string | null, teamIds: string[]): RegisterState {
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const teamKey = teamIds.join(",");

  useEffect(() => {
    if (!bookingId || teamKey.length === 0) {
      setLoading(false);
      return;
    }
    let active = true;
    const supabase = getSupabase();

    void (async () => {
      try {
        const [membersResult, marksResult] = await Promise.all([
          supabase
            .from("team_memberships")
            .select("person_id,role")
            .in("team_id", teamKey.split(","))
            .is("left_at", null),
          supabase
            .from("booking_attendance")
            .select("person_id,status")
            .eq("booking_id", bookingId),
        ]);
        if (membersResult.error) throw membersResult.error;
        if (marksResult.error) throw marksResult.error;

        const members = membersResult.data ?? [];
        const playerIds = [
          ...new Set(members.filter((m) => m.role === "player").map((m) => m.person_id)),
        ];
        const names = new Map<string, string>();
        await Promise.all(
          playerIds.map(async (id) => {
            const { data } = await supabase.rpc("display_name", { p_person_id: id });
            if (typeof data === "string" && data) names.set(id, data);
          }),
        );
        if (!active) return;

        const marks = new Map(
          (marksResult.data ?? []).map((row) => [row.person_id, row.status] as const),
        );
        setRows(toRegister(members, names, marks));
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Could not load the register.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [bookingId, teamKey]);

  const mark = useCallback(
    async (personId: string, status: Enums<"attendance_status">) => {
      if (!bookingId) return;
      setSaving(personId);

      // Optimistic, like every toggle in this app: move under the thumb.
      const previous = rows;
      setRows((current) =>
        current.map((row) => (row.personId === personId ? { ...row, status } : row)),
      );

      try {
        const { error: upsertError } = await getSupabase()
          .from("booking_attendance")
          .upsert(
            { booking_id: bookingId, person_id: personId, status },
            { onConflict: "booking_id,person_id" },
          );
        if (upsertError) throw upsertError;
        setError(null);
      } catch (caught) {
        setRows(previous);
        setError(caught instanceof Error ? caught.message : "Could not save that mark.");
      } finally {
        setSaving(null);
      }
    },
    [bookingId, rows],
  );

  return { rows, loading, error, saving, mark };
}
