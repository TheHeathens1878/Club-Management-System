import type { Enums } from "@club/db";
import { useCallback, useEffect, useState } from "react";

import {
  toSessions,
  type Session,
  type SessionAvailabilityRow,
  type SessionRow,
} from "./sessions";
import { getSupabase } from "./supabase";
import type { Household } from "./use-household";

/**
 * Upcoming training sessions for the household's teams, with the household's
 * own "can you make it" answers (`booking_availability`).
 *
 * The window comes from `pitch_calendar()` — the members-and-guardians view of
 * the pitch diary, no booker PII — and the toggle writes exactly what the
 * `booking_availability_insert` policy allows: yourself, or a child you guard,
 * who is in one of the session's teams.
 */

/** A session that started an hour ago is still tonight's session. */
const GRACE_HOURS = 3;
const HORIZON_DAYS = 45;

export interface SessionsState {
  sessions: Session[];
  loading: boolean;
  error: string | null;
  /** Set while a toggle is in flight, keyed `${bookingId}:${personId}`. */
  saving: string | null;
  refresh: () => void;
  setAvailability: (
    bookingId: string,
    personId: string,
    status: Enums<"availability_status">,
  ) => Promise<void>;
}

export function useSessions(household: Household | null): SessionsState {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  const teamIds = (household?.playerMemberships ?? [])
    .map((membership) => membership.teamId)
    .join(",");
  const personIds = (household?.members ?? [])
    .map((member) => member.personId)
    .join(",");

  useEffect(() => {
    if (!household || teamIds.length === 0) {
      setSessions([]);
      setLoading(false);
      return;
    }

    let active = true;
    const supabase = getSupabase();

    void (async () => {
      try {
        const from = new Date(Date.now() - GRACE_HOURS * 60 * 60 * 1000).toISOString();
        const to = new Date(Date.now() + HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const { data: rows, error: calendarError } = await supabase.rpc("pitch_calendar", {
          p_from: from,
          p_to: to,
        });
        if (calendarError) throw calendarError;
        if (!active) return;

        const sessionRows = (rows ?? []) as unknown as SessionRow[];

        let availability: SessionAvailabilityRow[] = [];
        const trainingIds = sessionRows
          .filter((row) => row.kind === "training")
          .map((row) => row.booking_id);
        if (trainingIds.length > 0 && personIds.length > 0) {
          const { data: availabilityRows, error: availabilityError } = await supabase
            .from("booking_availability")
            .select("booking_id, person_id, status")
            .in("booking_id", trainingIds)
            .in("person_id", personIds.split(","));
          if (availabilityError) throw availabilityError;
          availability = (availabilityRows ?? []) as SessionAvailabilityRow[];
        }

        if (!active) return;
        setSessions(
          toSessions(sessionRows, household.members, household.playerMemberships, availability),
        );
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof Error ? caught.message : "Could not load your training sessions.",
        );
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
    // Keyed on the id strings rather than on `household`, which is a fresh
    // object on every render of the parent.
  }, [household, teamIds, personIds, nonce]);

  const setAvailability = useCallback(
    async (bookingId: string, personId: string, status: Enums<"availability_status">) => {
      const key = `${bookingId}:${personId}`;
      setSaving(key);

      // Optimistic, like the fixtures toggle: move under the thumb.
      const previous = sessions;
      setSessions((current) =>
        current.map((session) =>
          session.id === bookingId
            ? {
                ...session,
                respondents: session.respondents.map((respondent) =>
                  respondent.personId === personId ? { ...respondent, status } : respondent,
                ),
              }
            : session,
        ),
      );

      try {
        const { error: upsertError } = await getSupabase()
          .from("booking_availability")
          .upsert(
            { booking_id: bookingId, person_id: personId, status },
            { onConflict: "booking_id,person_id" },
          );
        if (upsertError) throw upsertError;
        setError(null);
      } catch (caught) {
        setSessions(previous);
        setError(
          caught instanceof Error ? caught.message : "Could not save that availability.",
        );
      } finally {
        setSaving(null);
      }
    },
    [sessions],
  );

  return { sessions, loading, error, saving, refresh, setAvailability };
}
