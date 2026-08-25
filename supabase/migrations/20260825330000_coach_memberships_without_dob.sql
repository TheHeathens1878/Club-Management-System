-- =============================================================================
-- A coach reaches their team without a date of birth; the date is asked for at sign-in
-- =============================================================================
-- Adam, 2026-08-25: "attach all coaches to the teams, even without the DOB.
-- Just make the DOB mandatory for the first time they login."
--
-- WHAT WAS STUCK
--   The Neon import queued a membership for anybody whose date of birth it did
--   not know (P3.3), and `apply_neon_pending()` refused to apply ANY of them
--   until the date arrived. Forty-five of the forty-seven rows waiting on
--   production are coaches, assistant coaches and managers — so the people who
--   run the teams were the ones not attached to them, and the club could not
--   see its own coaching staff.
--
--   The reason that gate exists is SG-0: an unknown date of birth is treated
--   as a minor, and a "minor coach" would have poisoned SG-6's composition
--   arithmetic for every child added to that team afterwards. That is a real
--   rule and it stays — but it is not the rule that binds here:
--
--     · SG-6 in-app enforcement has been OFF since 20260824240000 (the FA
--       Clubs Portal is the club's system of record for DBS and safeguarding
--       certificates), so the arithmetic the gate protected is not being run;
--     · a coach with no date of birth is not a child in anybody's mind, and
--       the club's own coaching list being empty is its own safeguarding
--       problem — you cannot check certificates for staff you cannot see;
--     · and the date is now ASKED FOR, not waited for (below).
--
-- SO: staff memberships apply without a date of birth. A PLAYER's does not —
-- an unknown date of birth is what SG-0 is about, and a player's age group is
-- derived from it, so that row keeps waiting exactly as before.
--
-- THE DATE IS ASKED FOR AT SIGN-IN
--   `needs_dob_completion()` asked only about accounts imported from the
--   pitch-booking app (`legacy_neon_user_id is not null`). It now asks about
--   ANY signed-in person whose date of birth the club does not hold, so the
--   middleware's first-login gate stops them at /complete-profile until they
--   give it — which is the trade this migration makes: the membership lands
--   now, the date arrives the first time they sign in.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no table, no policy change);
-- data touched: applies the queued staff memberships that were waiting on a
-- date of birth (inserts into team_memberships; no row is deleted, and the
-- queue rows are marked applied as they always have been); rollback: §3.
-- =============================================================================


-- =============================================================================
-- 1. THE FIRST-LOGIN GATE ASKS EVERYONE
-- =============================================================================

create or replace function public.needs_dob_completion()
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.people p
     where p.id = public.current_person_id()
       and p.dob is null
       and p.deleted_at is null
  );
$$;

comment on function public.needs_dob_completion() is
  'True when the signed-in person has no date of birth on record. The middleware holds them at /complete-profile until they give it (Adam, 2026-08-25: mandatory at first login), which is what lets a membership be applied before it is known.';


-- =============================================================================
-- 2. STAFF MEMBERSHIPS NO LONGER WAIT FOR IT
-- =============================================================================
-- The body is 20260824000000's, with one change: the date-of-birth refusal
-- now applies to player rows only. Everything else — the season lookup, the
-- D-P3-2 exemptions, the per-row sub-transaction, the idempotency — is
-- unchanged, deliberately copied rather than rewritten.

create or replace function public.apply_neon_pending(p_person_id uuid default null)
  returns table (applied integer, still_pending integer)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r          record;
  v_applied  integer := 0;
  v_season   uuid;
  v_lead     uuid;
  v_id       uuid;
  v_role     public.team_role;
  v_team     uuid;
begin
  select id into v_season from public.seasons where is_current;
  select r2.person_id into v_lead
    from public.person_roles r2
   where r2.role = 'safeguarding_lead' and r2.revoked_at is null
   order by r2.granted_at limit 1;

  for r in
    select q.* from public.neon_import_pending q
     where q.applied_at is null
       and (p_person_id is null or q.person_id = p_person_id)
     order by case q.kind when 'guardianship' then 0 else 1 end, q.id
  loop
    begin
      if r.kind = 'guardianship' then
        insert into public.guardianships (guardian_person_id, child_person_id, relationship, notes)
        values (r.person_id, (r.payload ->> 'child_person_id')::uuid,
                (r.payload ->> 'relationship')::public.guardian_relationship,
                'imported from Neon pitch-booking (P3.3)')
        on conflict do nothing
        returning id into v_id;
        if v_id is null then
          select g.id into v_id from public.guardianships g
           where g.guardian_person_id = r.person_id
             and g.child_person_id = (r.payload ->> 'child_person_id')::uuid;
        end if;
      else
        if v_season is null then
          raise exception 'no current season' using errcode = 'P0001';
        end if;
        v_role := (r.payload ->> 'role')::public.team_role;
        v_team := (r.payload ->> 'team_id')::uuid;

        -- SG-0 still holds a PLAYER's membership: their age group is derived
        -- from the date, and an unknown date is what the rule is about. A
        -- coach, assistant coach or manager goes on now (Adam, 2026-08-25) and
        -- gives the date at their first sign-in.
        if v_role = 'player'::public.team_role
           and (select p.dob from public.people p where p.id = r.person_id) is null then
          raise exception 'date of birth unknown — waiting for the first-login DOB gate (SG-0)' using errcode = 'P0001';
        end if;

        if public.is_child_facing_role(v_role)
           and public.team_has_minors(v_team)
           and not public.is_child_facing_compliant(r.person_id, v_team)
        then
          if v_lead is null then
            raise exception 'no safeguarding_lead exists to grant the certification exemption (D-P3-2)' using errcode = 'P0001';
          end if;
          insert into public.certification_exemptions (person_id, team_id, reason, granted_by_person_id, expires_on)
          values (r.person_id, v_team,
                  'Neon pitch-booking import (D-P3-2): certifications to be recorded within 30 days',
                  v_lead, (now() at time zone 'Europe/London')::date + 30);
        end if;

        -- Adding a minor to a team whose child-facing members are not yet
        -- compliant: grant each of them the same 30-day exemption first.
        if public.is_minor(r.person_id) and v_role = 'player'::public.team_role then
          if exists (select 1 from public.team_noncompliant_child_facing(v_team) n where n.person_id <> r.person_id) then
            if v_lead is null then
              raise exception 'no safeguarding_lead exists to grant the certification exemption (D-P3-2)' using errcode = 'P0001';
            end if;
            insert into public.certification_exemptions (person_id, team_id, reason, granted_by_person_id, expires_on)
            select n.person_id, v_team,
                   'Neon pitch-booking import (D-P3-2): certifications to be recorded within 30 days',
                   v_lead, (now() at time zone 'Europe/London')::date + 30
              from public.team_noncompliant_child_facing(v_team) n
             where n.person_id <> r.person_id;
          end if;
        end if;

        insert into public.team_memberships (person_id, team_id, season_id, role, notes)
        values (r.person_id, v_team, v_season, v_role,
                nullif('imported from Neon pitch-booking (P3.3)'
                       || coalesce('; ' || (r.payload ->> 'display_name'), ''), ''))
        on conflict do nothing
        returning id into v_id;
        if v_id is null then
          select m.id into v_id from public.team_memberships m
           where m.person_id = r.person_id and m.team_id = v_team and m.season_id = v_season
             and m.role = v_role and m.left_at is null;
        end if;
      end if;

      update public.neon_import_pending
         set applied_at = now(), last_error = null
       where id = r.id;
      v_applied := v_applied + 1;
    exception when others then
      update public.neon_import_pending
         set attempts = attempts + 1, last_error = sqlerrm
       where id = r.id;
    end;
  end loop;

  return query
    select v_applied,
           (select count(*)::integer from public.neon_import_pending q
             where q.applied_at is null
               and (p_person_id is null or q.person_id = p_person_id));
end;
$$;

comment on function public.apply_neon_pending(uuid) is
  'Applies the queued Neon import rows. A player''s membership still waits for a date of birth (SG-0); a coach, assistant coach or manager no longer does — the date is asked for at their first sign-in instead (20260825330000).';


-- =============================================================================
-- 3. THE COACHES WHO HAVE BEEN WAITING
-- =============================================================================
-- Runs as the migration (no auth.uid()), the same path the cron uses. Failures
-- are recorded on the queue row, never raised, so this cannot fail the deploy.

do $$
declare
  v_result record;
begin
  select * into v_result from public.apply_neon_pending();
  raise notice 'apply_neon_pending: % applied, % still pending', v_result.applied, v_result.still_pending;
end $$;

notify pgrst, 'reload schema';

-- Rollback (documented, not executed):
--   restore needs_dob_completion() and apply_neon_pending() from
--   20260824000000_neon_import.sql. The memberships created above are ordinary
--   team_memberships rows; ending one is `left_at`, a deliberate act, not a
--   migration.
