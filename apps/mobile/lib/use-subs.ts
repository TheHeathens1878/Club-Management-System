import { useCallback, useEffect, useState } from "react";

import { toArrears, type Arrears, type ArrearsRow } from "./subs";
import type { Household } from "./use-household";
import { getSupabase } from "./supabase";

/**
 * The household's outstanding subs, from the `subscription_arrears` view
 * (P4.1). The view nets refunds off and hides names the caller may not see, so
 * the app never adds money up itself.
 *
 * Two things can put a row in front of you: it is for someone in your
 * household, or you are the payer for someone else's.
 */

const ARREARS_SELECT =
  "subscription_id, person_id, person_name, payer_person_id, plan_id, plan_name, team_name, status, amount_due_pence, paid_pence, outstanding_pence, days_since_start, started_at";

export interface SubsState {
  arrears: Arrears[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSubs(household: Household | null): SubsState {
  const [arrears, setArrears] = useState<Arrears[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setNonce((value) => value + 1);
  }, []);

  const personId = household?.personId ?? null;
  const personIds = (household?.members ?? [])
    .map((member) => member.personId)
    .join(",");

  useEffect(() => {
    if (!personId) {
      setArrears([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let active = true;
    const supabase = getSupabase();

    void (async () => {
      try {
        const ids = personIds.length > 0 ? personIds : personId;
        const { data, error: viewError } = await supabase
          .from("subscription_arrears")
          .select(ARREARS_SELECT)
          .or(`person_id.in.(${ids}),payer_person_id.eq.${personId}`);
        if (viewError) throw viewError;
        if (!active) return;

        setArrears(toArrears((data ?? []) as ArrearsRow[], personId));
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof Error ? caught.message : "Could not load your subs.",
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
  }, [personId, personIds, nonce]);

  return { arrears, loading, refreshing, error, refresh };
}
