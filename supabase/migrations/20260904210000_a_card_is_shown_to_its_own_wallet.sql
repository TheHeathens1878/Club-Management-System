-- =============================================================================
-- A card is shown to its own wallet (Adam, 2026-09-04: "When I view as me
-- (not admin) I can see everybody's membership card. Me - should just see
-- mine and sub-members. Coach - those in their team(s). Parent - just mine
-- and sub-members.")
--
-- The page half of that is the web app's (the /membership-card screen now
-- scopes what it renders to the role view — the "hat, not just capability"
-- rule, applied to the data read). The DATABASE half is the coach's door,
-- which did not exist: team staff hold no billing read at all, and should
-- not — a coach has no business in another household's charges. What a coach
-- legitimately sees is the CARD of a player in their own squad: number,
-- letter, name. This function is that door and nothing more.
--
-- SECURITY DEFINER with the same gate shape as conversation_member_labels
-- (20260904150000): rows come back only for teams the caller staffs
-- (is_team_staff), and only live players of active teams with a live card.
-- A member, a parent, a referee calling it gets an empty set, not an error —
-- the join with the caller's staffed teams is the gate.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy changes — one
-- SECURITY DEFINER read function whose visibility is narrower than any
-- policy: card references of the caller's own squads); data touched: none;
-- rollback: drop function public.team_player_cards().
-- =============================================================================

create or replace function public.team_player_cards()
  returns table (
    person_id  uuid,
    first_name text,
    last_name  text,
    card_ref   text,
    team_id    uuid,
    team_name  text
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.id,
         p.first_name,
         p.last_name,
         lpad(a.member_no::text, 5, '0') || bap.letter,
         t.id,
         t.name
    from public.team_memberships tm
    join public.teams t on t.id = tm.team_id and t.active
    join public.people p on p.id = tm.person_id and p.deleted_at is null
    join public.billing_account_people bap on bap.person_id = p.id and bap.removed_at is null
    join public.billing_accounts a on a.id = bap.account_id
   where tm.role = 'player'
     and tm.left_at is null
     and public.is_team_staff(tm.team_id)
   order by t.name, p.last_name, p.first_name;
$$;

revoke all privileges on function public.team_player_cards() from public, anon;
grant execute on function public.team_player_cards() to authenticated, service_role;

comment on function public.team_player_cards() is
  'The coach''s door to membership cards: number, letter and name for live players of the caller''s own active squads — nothing for anyone else, and no billing detail for anyone.';

notify pgrst, 'reload schema';
