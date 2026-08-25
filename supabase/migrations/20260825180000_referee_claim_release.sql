-- =============================================================================
-- A claimed game can be handed back — by the referee, or by the coach who posted it
-- =============================================================================
-- Adam, 2026-08-25: "In referees group, refs and coaches can remove their
-- claim to a game and it reopens it."
--
-- 20260825030000 let only a club administrator clear a claim ("referee dropped
-- out"). That made the ordinary Saturday-morning case — a referee who can no
-- longer make it, or a coach whose fixture moved — a phone call to an admin.
-- The guard now admits three people to a RELEASE (claimed → unclaimed):
--
--   · the referee who holds the claim (their own change of plan);
--   · the person who posted the game (it is their fixture);
--   · a club administrator, as before.
--
-- Nothing else moves. A release is the only transition a claim can make other
-- than to nothing: handing a claimed game to a DIFFERENT referee in one step
-- is still refused, so "reopens it" is literally what happens — the card goes
-- back to Referee needed and the next referee claims it under the same rule
-- as the first (self, referee hat). The card's details stay frozen.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (the update policy already
-- admits any active participant — the guard trigger is the arbiter and only
-- the guard changes); data touched: none; rollback: re-run the function body
-- from 20260825030000 (the admin-only release).
-- =============================================================================

create or replace function public.referee_match_posts_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me uuid := public.current_person_id();
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.message_id, new.conversation_id, new.posted_by_person_id,
      coalesce(new.fixture_id, '00000000-0000-0000-0000-000000000000'::uuid),
      new.fixture_text, coalesce(new.duration_text, ''), coalesce(new.format_text, ''),
      coalesce(new.location_text, ''), coalesce(new.surface, ''),
      coalesce(new.kickoff_at, 'epoch'::timestamptz), coalesce(new.fee_text, ''))
     is distinct from
     (old.message_id, old.conversation_id, old.posted_by_person_id,
      coalesce(old.fixture_id, '00000000-0000-0000-0000-000000000000'::uuid),
      old.fixture_text, coalesce(old.duration_text, ''), coalesce(old.format_text, ''),
      coalesce(old.location_text, ''), coalesce(old.surface, ''),
      coalesce(old.kickoff_at, 'epoch'::timestamptz), coalesce(old.fee_text, ''))
  then
    raise exception 'referee_match_posts: a posted card''s details cannot be edited' using errcode = 'P0001';
  end if;

  -- Claim: unclaimed → claimed, by the caller, who must hold the referee hat.
  if old.claimed_by_person_id is null and new.claimed_by_person_id is not null then
    if new.claimed_by_person_id <> v_me then
      raise exception 'referee_match_posts: a game is claimed for yourself, not somebody else' using errcode = 'P0001';
    end if;
    if not public.person_has_role(new.claimed_by_person_id, 'referee'::public.app_role) then
      raise exception 'referee_match_posts: only an approved referee may claim a game' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- Release: claimed → unclaimed, by the referee holding it, the poster, or a
  -- club administrator. The pair constraint keeps claimed_at in step.
  if old.claimed_by_person_id is not null and new.claimed_by_person_id is null then
    if v_me is distinct from old.claimed_by_person_id
       and v_me is distinct from old.posted_by_person_id
       and not public.is_club_admin()
    then
      raise exception 'referee_match_posts: only the referee who claimed this game, the person who posted it or a club administrator can release it'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- Anything else that moves a live claim (to another referee in one step) is refused.
  if old.claimed_by_person_id is not null
     and new.claimed_by_person_id is distinct from old.claimed_by_person_id
  then
    raise exception 'referee_match_posts: this game is already claimed — release it first and it reopens for the next referee'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.referee_match_posts_guard() is
  'Freezes a posted card''s details; admits a claim by the caller (referee hat) and a release by the claiming referee, the poster or a club admin — a released game reopens.';

notify pgrst, 'reload schema';
