import { useCallback, useEffect, useState } from "react";

import {
  buildHousehold,
  type GuardianshipRow,
  type HouseholdMember,
} from "./household";
import {
  groupTeamsByPerson,
  playerMemberships,
  type HouseholdMembershipRow,
  type HouseholdTeams,
} from "./teams";
import type { PlayerMembership } from "./fixtures";
import { getSupabase } from "./supabase";

/**
 * The one read every other tab depends on: who am I, whose children do I
 * answer for, and which teams are they all in.
 *
 * Everything goes through the *user* client, so RLS decides. A guardianship
 * that has ended, or a team a member cannot see, simply does not come back.
 * Names come from the `display_name()` RPC rather than a `people` select: the
 * function is the database's own answer to "may this caller see this name".
 */

const MEMBERSHIP_SELECT =
  "id, person_id, role, shirt_number, joined_at, left_at, teams:team_id (id, name, age_group), seasons:season_id (id, name, is_current)";

export interface Household {
  personId: string | null;
  members: HouseholdMember[];
  membershipRows: HouseholdMembershipRow[];
  teamsByPerson: HouseholdTeams[];
  playerMemberships: PlayerMembership[];
  isClubAdmin: boolean;
}

export interface HouseholdState {
  data: Household | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

const EMPTY: Household = {
  personId: null,
  members: [],
  membershipRows: [],
  teamsByPerson: [],
  playerMemberships: [],
  isClubAdmin: false,
};

/** Resolves several person ids to names in parallel. */
export async function displayNames(
  personIds: readonly string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(personIds)].filter((id) => id.length > 0);
  if (unique.length === 0) return {};

  const supabase = getSupabase();
  const results = await Promise.all(
    unique.map(async (personId) => {
      const { data, error } = await supabase.rpc("display_name", {
        p_person_id: personId,
      });
      // A name the caller may not see comes back as an error or as null; the
      // caller substitutes a neutral label rather than failing the screen.
      return [personId, error || !data ? "" : String(data)] as const;
    }),
  );

  return Object.fromEntries(results.filter(([, name]) => name.length > 0));
}

export function useHousehold(userId: string | undefined): HouseholdState {
  const [data, setData] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!userId) {
      setData(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let active = true;
    const supabase = getSupabase();

    void (async () => {
      try {
        const { data: personId, error: personError } =
          await supabase.rpc("current_person_id");
        if (personError) throw personError;
        if (!active) return;

        if (!personId) {
          setData(EMPTY);
          setError(null);
          return;
        }

        const [
          { data: guardianRows, error: guardianError },
          { data: adminFlag },
        ] = await Promise.all([
          supabase
            .from("guardianships")
            .select("child_person_id, relationship, ended_at")
            .eq("guardian_person_id", personId)
            .is("ended_at", null),
          supabase.rpc("is_club_admin"),
        ]);
        if (guardianError) throw guardianError;

        const guardianships = (guardianRows ?? []) as GuardianshipRow[];
        const names = await displayNames([
          personId,
          ...guardianships.map((row) => row.child_person_id),
        ]);
        if (!active) return;

        const members = buildHousehold(
          personId,
          names[personId] ?? "",
          guardianships,
          names,
        );

        const { data: membershipRows, error: membershipError } = await supabase
          .from("team_memberships")
          .select(MEMBERSHIP_SELECT)
          .in(
            "person_id",
            members.map((member) => member.personId),
          )
          .is("left_at", null);
        if (membershipError) throw membershipError;
        if (!active) return;

        const rows = (membershipRows ?? []) as unknown as HouseholdMembershipRow[];

        setData({
          personId,
          members,
          membershipRows: rows,
          teamsByPerson: groupTeamsByPerson(members, rows),
          playerMemberships: playerMemberships(rows),
          isClubAdmin: adminFlag === true,
        });
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load your club details.",
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
  }, [userId, nonce]);

  return { data, loading, refreshing, error, refresh };
}
