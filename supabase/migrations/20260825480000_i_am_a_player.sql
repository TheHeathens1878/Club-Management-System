-- =============================================================================
-- "I am a player" — a person says whether they play
-- =============================================================================
-- Adam, 2026-08-26: "There should be a tick box on My Profile saying I am a
-- player. Emergency contacts hidden if not, and player doesn't appear on
-- Register Players if this is not ticked."
--
-- WHY A COLUMN AND NOT AN INFERENCE
--   The club can infer that somebody plays — a live player membership, a
--   registration — but not that they DON'T. An adult who has never registered
--   looks exactly like an adult who never will, and the difference decides
--   whether the app asks them for an emergency contact and offers them to
--   register. That is a statement about themselves, so it is theirs to make:
--   `people.is_player`, set by nobody but the person (and a club
--   administrator, who already writes every other field on the record).
--
-- THE BACKFILL IS THE HONEST DEFAULT
--   `false` for a new row, but anybody the club ALREADY treats as a player —
--   a live `team_memberships` row with role 'player', or any registration that
--   is not withdrawn or rejected — starts ticked. Nobody who already plays has
--   to find the box before their emergency contacts stop hiding.
--
-- WHAT IT DOES NOT DO
--   It is not a permission and not a safeguarding control: nothing reads it to
--   decide access. It decides which questions a screen asks. A person who
--   unticks it while holding a live player membership keeps the membership —
--   the club's record of who is on a team is the team sheet, not a self-service
--   tick — and the screens simply stop asking them player questions.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy added or altered;
-- the column rides the existing `people` policies, and the write goes through
-- the existing self-service RPC); data touched: yes — one boolean backfilled
-- from memberships and registrations; rollback: §4.
-- =============================================================================


-- =============================================================================
-- 1. THE COLUMN
-- =============================================================================

alter table public.people
  add column if not exists is_player boolean not null default false;

comment on column public.people.is_player is
  'Does this person play for the club? Their own statement (My Profile), or a club administrator''s on their behalf. Decides which questions the screens ask — never who may read or do anything.';


-- =============================================================================
-- 2. THE BACKFILL
-- =============================================================================

update public.people p
   set is_player = true
 where p.is_player = false
   and (
     exists (select 1 from public.team_memberships m
              where m.person_id = p.id and m.left_at is null and m.role = 'player')
     or exists (select 1 from public.registrations r
                 where r.person_id = p.id
                   and r.status not in ('withdrawn', 'rejected'))
   );


-- =============================================================================
-- 3. SETTING IT
-- =============================================================================
-- `update_own_contact()` is already the one door a person has onto their own
-- record. It gains a fourth argument rather than growing a second function,
-- and keeps its coalesce shape: a NULL leaves the flag as it is, so every
-- existing caller (the profile form posts all four) is unaffected.

create or replace function public.update_own_contact(
  p_address jsonb default null, p_phone text default null, p_preferred_name text default null,
  p_is_player boolean default null
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_me uuid := public.current_person_id();
begin
  if v_me is null then
    raise exception 'update_own_contact: no person is linked to this login' using errcode = '42501';
  end if;
  if p_address is not null and jsonb_typeof(p_address) <> 'object' then
    raise exception 'update_own_contact: the address must be an object' using errcode = 'P0001';
  end if;
  update public.people
     set address        = coalesce(p_address, address),
         phone          = coalesce(nullif(btrim(p_phone), ''), phone),
         preferred_name = coalesce(nullif(btrim(p_preferred_name), ''), preferred_name),
         is_player      = coalesce(p_is_player, is_player)
   where id = v_me and deleted_at is null;
end $$;

comment on function public.update_own_contact(jsonb, text, text, boolean) is
  'A signed-in person corrects their own contact details and says whether they play. Name, email and date of birth are not parameters: the club owns those.';

revoke all privileges on function public.update_own_contact(jsonb, text, text, boolean) from public, anon;
grant execute on function public.update_own_contact(jsonb, text, text, boolean) to authenticated;

-- The three-argument form is what every deployed client calls until the new
-- one ships; drop it only once nothing references it. Postgres treats the two
-- as separate functions, so leaving it would make an ambiguous call — the
-- default on the fourth argument covers the old shape exactly.
drop function if exists public.update_own_contact(jsonb, text, text);

notify pgrst, 'reload schema';


-- =============================================================================
-- 4. ROLLBACK (documented, not executed)
-- =============================================================================
--   create or replace function public.update_own_contact(jsonb, text, text) …
--     (the body from 20260824280000_join_flow.sql);
--   drop function public.update_own_contact(jsonb, text, text, boolean);
--   alter table public.people drop column is_player;
-- The backfilled values are lost with the column; they are derived from
-- memberships and registrations, so the same statement recreates them.
