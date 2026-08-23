import { useCallback, useEffect, useState } from "react";

import {
  toTeamMemberships,
  type MembershipRow,
  type ProfileRow,
  type TeamMembership,
} from "./club";
import { getSupabase } from "./supabase";

/**
 * Everything the "My club" screen needs, read through the *user* client only:
 * the anon key plus the signed-in session, so RLS decides what comes back. A
 * member who can see nothing gets an empty list, not an error.
 */
const PROFILE_SELECT =
  "id, person_id, full_name, role, people:person_id (id, first_name, last_name, preferred_name, email)";

const MEMBERSHIP_SELECT =
  "id, role, shirt_number, joined_at, left_at, teams:team_id (id, name, age_group), seasons:season_id (id, name, is_current)";

export interface MyClub {
  profile: ProfileRow | null;
  memberships: TeamMembership[];
}

export interface MyClubState {
  data: MyClub | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

export function useMyClub(userId: string | undefined): MyClubState {
  const [data, setData] = useState<MyClub | null>(null);
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
        const { data: profileRow, error: profileError } = await supabase
          .from("profiles")
          .select(PROFILE_SELECT)
          .eq("id", userId)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!active) return;

        const profile = (profileRow ?? null) as ProfileRow | null;

        let memberships: TeamMembership[] = [];
        if (profile?.person_id) {
          const { data: rows, error: membershipError } = await supabase
            .from("team_memberships")
            .select(MEMBERSHIP_SELECT)
            .eq("person_id", profile.person_id)
            .is("left_at", null);
          if (membershipError) throw membershipError;
          memberships = toTeamMemberships((rows ?? []) as MembershipRow[]);
        }

        if (!active) return;
        setData({ profile, memberships });
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
