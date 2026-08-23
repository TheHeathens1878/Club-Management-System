import type { Enums } from "@club/db";
import { useCallback, useEffect, useState } from "react";

import {
  toFixtures,
  type AvailabilityRow,
  type Fixture,
  type FixtureRow,
} from "./fixtures";
import type { Household } from "./use-household";
import { teamSeasonKeys } from "./teams";
import { getSupabase } from "./supabase";

/**
 * Upcoming fixtures for every team anyone in the household plays for, with the
 * household's own availability answers.
 *
 * The pitch is joined in from `resources` through `fixtures.venue_resource_id`,
 * which P2.5 fills in when it allocates. Until then the shaping in
 * lib/fixtures.ts renders "Pitch TBC".
 */

const FIXTURE_SELECT =
  "id, team_id, season_id, opponent, is_home, kickoff_at, competition, status, venue_resource_id, venue_text, teams:team_id (id, name), resources:venue_resource_id (id, name)";

/** How far back to look, so a fixture that kicked off an hour ago still shows. */
const GRACE_HOURS = 3;

const HORIZON_DAYS = 120;

export interface FixturesState {
  fixtures: Fixture[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Set while a toggle is in flight, keyed `${fixtureId}:${personId}`. */
  saving: string | null;
  refresh: () => void;
  setAvailability: (
    fixtureId: string,
    personId: string,
    status: Enums<"availability_status">,
  ) => Promise<void>;
}

export function useFixtures(household: Household | null): FixturesState {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setNonce((value) => value + 1);
  }, []);

  const teamIds = teamSeasonKeys(household?.membershipRows ?? [])
    .map((key) => key.teamId)
    .join(",");
  const personIds = (household?.members ?? [])
    .map((member) => member.personId)
    .join(",");

  useEffect(() => {
    if (!household || teamIds.length === 0) {
      setFixtures([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let active = true;
    const supabase = getSupabase();

    void (async () => {
      try {
        const from = new Date(
          Date.now() - GRACE_HOURS * 60 * 60 * 1000,
        ).toISOString();
        const to = new Date(
          Date.now() + HORIZON_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();

        const { data: fixtureRows, error: fixtureError } = await supabase
          .from("fixtures")
          .select(FIXTURE_SELECT)
          .in("team_id", teamIds.split(","))
          .gte("kickoff_at", from)
          .lte("kickoff_at", to)
          .order("kickoff_at", { ascending: true })
          .limit(60);
        if (fixtureError) throw fixtureError;
        if (!active) return;

        const rows = (fixtureRows ?? []) as unknown as FixtureRow[];

        let availability: AvailabilityRow[] = [];
        if (rows.length > 0 && personIds.length > 0) {
          const { data: availabilityRows, error: availabilityError } =
            await supabase
              .from("availability")
              .select("fixture_id, person_id, status")
              .in(
                "fixture_id",
                rows.map((row) => row.id),
              )
              .in("person_id", personIds.split(","));
          if (availabilityError) throw availabilityError;
          availability = (availabilityRows ?? []) as AvailabilityRow[];
        }

        if (!active) return;
        setFixtures(
          toFixtures(
            rows,
            household.members,
            household.playerMemberships,
            availability,
          ),
        );
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load your fixtures.",
        );
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
    // Keyed on the id strings rather than on `household`, which is a fresh
    // object on every render of the parent.
  }, [household, teamIds, personIds, nonce]);

  const setAvailability = useCallback(
    async (
      fixtureId: string,
      personId: string,
      status: Enums<"availability_status">,
    ) => {
      const key = `${fixtureId}:${personId}`;
      setSaving(key);

      // Optimistic: the toggle should move under the thumb, not after a
      // round trip on a phone signal at a windy touchline.
      const previous = fixtures;
      setFixtures((current) =>
        current.map((fixture) =>
          fixture.id === fixtureId
            ? {
                ...fixture,
                respondents: fixture.respondents.map((respondent) =>
                  respondent.personId === personId
                    ? { ...respondent, status }
                    : respondent,
                ),
              }
            : fixture,
        ),
      );

      try {
        // `can_act_for()` in the RLS policy is what allows a guardian to answer
        // for a child; the app never assumes it, it just tries and reports.
        const { error: upsertError } = await getSupabase()
          .from("availability")
          .upsert(
            { fixture_id: fixtureId, person_id: personId, status },
            { onConflict: "fixture_id,person_id" },
          );
        if (upsertError) throw upsertError;
        setError(null);
      } catch (caught) {
        setFixtures(previous);
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not save that availability.",
        );
      } finally {
        setSaving(null);
      }
    },
    [fixtures],
  );

  return {
    fixtures,
    loading,
    refreshing,
    error,
    saving,
    refresh,
    setAvailability,
  };
}
