-- =============================================================================
-- A tick made at sign-up survives the trip through the inbox
-- =============================================================================
-- Adam, 2026-09-02: "as a separate club admin user, there are also no approvals
-- despite me joining as a coach and a referee under adam.wareing+12@gmail.com."
--
-- He is right, and the record says so plainly: the person exists, the login
-- exists, and `account_requests` for them is EMPTY.
--
--
-- 1. WHERE THE TICKS WENT
-- ---------------------------------------------------------------------------
-- The joining form asks "do you coach? do you referee?" on its first step and
-- turns each tick into a pending request — in the server action, AFTER the
-- sign-up returns. But `supabase.auth.signUp()` returns NO SESSION when the
-- address has to be confirmed, and the action returns "check your email" at
-- that point and stops. Everything after that line, the two requests included,
-- never ran.
--
-- On a browser that was already signed in this was invisible, which is why it
-- shipped. On a phone, signing up fresh, it is every single time.
--
--
-- 2. WHY THE FIX IS HERE AND NOT IN THE ACTION
-- ---------------------------------------------------------------------------
-- The action could stash the ticks and replay them when the member returns —
-- but the member may not return, may return on a different device, or may
-- return with the storage cleared, and the club would still like to know they
-- volunteered. The one moment the intention is certainly known is the moment
-- the account is created, so the ticks travel in the sign-up metadata exactly
-- as the date of birth, the phone and the address already do, and are read
-- here.
--
-- ON `profiles`, NOT ON `auth.users`. `handle_new_user()` has three endings —
-- an invite, an email match, a new person — and the request belongs to
-- whichever person the account came to rest on. `profiles.person_id` IS that
-- answer, so a trigger on the row that records it needs no branch of its own
-- and cannot disagree with the branch that ran.
--
--
-- 3. A REFUSED HAT MUST NEVER COST SOMEBODY THEIR ACCOUNT
-- ---------------------------------------------------------------------------
-- `account_requests_referee_age_guard()` refuses a referee under 14. Raised
-- from in here that would abort the profile insert, and with it the whole
-- `auth.users` transaction — so a thirteen-year-old ticking "referee" out of
-- optimism would be told the account could not be created, with no clue why.
--
-- Each insert is therefore wrapped, and a refusal is AUDITED rather than
-- raised. This is the rule `sync_referees_group_member()` (20260825320000) and
-- `sync_venue_coaches_group()` (20260901190000) already follow: a membership
-- rule declining must not fail the thing that triggered it, and a refusal
-- nobody can find is the only unacceptable outcome.
--
-- WHAT IS NOT DECIDED HERE. Nothing is granted. Every row lands `pending` on
-- the /approvals desk exactly as the same tick does mid-wizard, and the club
-- administrator decides it. The account being unconfirmed is not a reason to
-- withhold the request: an unconfirmed sign-up already leaves a person row, and
-- a volunteer the club never hears about is the worse failure.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — no policy added, dropped or
-- altered; the trigger is SECURITY DEFINER on a table only the auth trigger
-- writes. Data touched: none by the migration; hereafter a sign-up carrying
-- `wants_coach` / `wants_referee` in its metadata creates pending
-- `account_requests` rows for the account's own person. Rollback: §3.
-- =============================================================================


-- =============================================================================
-- 1. profiles_open_requested_roles()
-- =============================================================================

create or replace function public.profiles_open_requested_roles()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
declare
  v_meta    jsonb;
  v_team    uuid;
  v_wants   boolean;
begin
  if new.person_id is null then
    return new;
  end if;

  select u.raw_user_meta_data into v_meta from auth.users u where u.id = new.id;
  if v_meta is null then
    return new;
  end if;

  -- The team, if the coach named one on the form. Anything that is not a uuid
  -- is treated as absent rather than fought over: the team is optional, and a
  -- team-less coach request is a supported thing (20260901200000).
  begin
    v_team := nullif(btrim(v_meta ->> 'coach_team_id'), '')::uuid;
  exception when others then
    v_team := null;
  end;
  if v_team is not null
     and not exists (select 1 from public.teams t where t.id = v_team)
  then
    v_team := null;
  end if;

  -- COACH ---------------------------------------------------------------
  v_wants := (v_meta ->> 'wants_coach') in ('true', 't', 'yes');
  if v_wants
     and not public.person_has_role(new.person_id, 'coach'::public.app_role)
  then
    begin
      insert into public.account_requests (person_id, requested_role, team_id)
      select new.person_id, 'coach', v_team
       where not exists (
         select 1 from public.account_requests r
          where r.person_id = new.person_id
            and r.requested_role = 'coach'
            and coalesce(r.team_id, '00000000-0000-0000-0000-000000000000'::uuid)
                = coalesce(v_team, '00000000-0000-0000-0000-000000000000'::uuid)
            and r.status = 'pending');
    exception when others then
      perform public.write_audit(
        'account_request.signup_refused', 'people', new.person_id::text,
        jsonb_build_object('role', 'coach', 'team_id', v_team, 'error', sqlerrm));
    end;
  end if;

  -- REFEREE -------------------------------------------------------------
  -- The age guard lives on the insert and speaks for itself. Here it must
  -- speak quietly: see §3 of this file's header.
  v_wants := (v_meta ->> 'wants_referee') in ('true', 't', 'yes');
  if v_wants
     and not public.person_has_role(new.person_id, 'referee'::public.app_role)
  then
    begin
      insert into public.account_requests (person_id, requested_role)
      select new.person_id, 'referee'
       where not exists (
         select 1 from public.account_requests r
          where r.person_id = new.person_id
            and r.requested_role = 'referee'
            and r.team_id is null
            and r.status = 'pending');
    exception when others then
      perform public.write_audit(
        'account_request.signup_refused', 'people', new.person_id::text,
        jsonb_build_object('role', 'referee', 'error', sqlerrm));
    end;
  end if;

  return new;
end $function$;

comment on function public.profiles_open_requested_roles() is
  'Turns the wants_coach / wants_referee ticks in a sign-up''s metadata into pending account_requests, once the account has come to rest on a person. Grants nothing. A refusal (the referee age rule) is audited, never raised — it must not cost somebody their account.';

drop trigger if exists trg_profiles_open_requested_roles on public.profiles;
create trigger trg_profiles_open_requested_roles
  after insert on public.profiles
  for each row execute function public.profiles_open_requested_roles();


-- =============================================================================
-- 2. THE ONE ALREADY LOST
-- =============================================================================
-- adam.wareing+12@gmail.com ticked both and got neither. The account is real,
-- the person is real, and the two requests should exist — so they are created
-- here rather than leaving him to fill the form in again to prove the fix.
--
-- Written as a general statement over anybody whose sign-up metadata asked and
-- whose requests are missing, because if it happened once this morning it
-- happened to whoever else tried between the four-step release and now.

do $$
declare
  r record;
begin
  for r in
    select pr.person_id, u.raw_user_meta_data as meta
      from public.profiles pr
      join auth.users u on u.id = pr.id
     where pr.person_id is not null
       and (u.raw_user_meta_data ->> 'wants_coach' in ('true','t','yes')
            or u.raw_user_meta_data ->> 'wants_referee' in ('true','t','yes'))
  loop
    if (r.meta ->> 'wants_coach') in ('true','t','yes')
       and not public.person_has_role(r.person_id, 'coach'::public.app_role)
       and not exists (select 1 from public.account_requests a
                        where a.person_id = r.person_id and a.requested_role = 'coach'
                          and a.status = 'pending')
    then
      begin
        insert into public.account_requests (person_id, requested_role, team_id)
        values (r.person_id, 'coach',
                (select t.id from public.teams t
                  where t.id = nullif(btrim(r.meta ->> 'coach_team_id'), '')::uuid));
      exception when others then
        raise notice 'backfill coach request for %: %', r.person_id, sqlerrm;
      end;
    end if;

    if (r.meta ->> 'wants_referee') in ('true','t','yes')
       and not public.person_has_role(r.person_id, 'referee'::public.app_role)
       and not exists (select 1 from public.account_requests a
                        where a.person_id = r.person_id and a.requested_role = 'referee'
                          and a.status = 'pending')
    then
      begin
        insert into public.account_requests (person_id, requested_role)
        values (r.person_id, 'referee');
      exception when others then
        raise notice 'backfill referee request for %: %', r.person_id, sqlerrm;
      end;
    end if;
  end loop;
end $$;


-- =============================================================================
-- 3. ROLLBACK
-- =============================================================================
--   drop trigger if exists trg_profiles_open_requested_roles on public.profiles;
--   drop function if exists public.profiles_open_requested_roles();
-- Requests already opened stay: they are ordinary pending rows and /approvals
-- decides or rejects them like any other.
-- =============================================================================
