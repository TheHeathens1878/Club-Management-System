-- =============================================================================
-- A guest in the coaches' room keeps their seat (Adam, 2026-09-04: "The app
-- keeps ejecting me (coach) from the Ashton Park group despite me adding me
-- twice").
--
-- `sync_venue_coaches_group()` seats every coach of a team that plays at the
-- venue (basis 'staff') and walks out anyone who no longer does. The walk-out
-- swept EVERYBODY active — including people an administrator had added by
-- hand through Group settings (basis 'member'). Adam added himself at 09:30
-- and 10:05 today; the next Full-Time import's sync stamped him out at 10:01
-- and 10:12. The sweep now touches only the seats the sync itself owns:
--
--     and p.basis = 'staff'
--
-- A hand-added member stays until they leave or are removed by hand — the
-- same standing as in any other group. Coaches remain automatic in both
-- directions, exactly as 20260901190000 intended.
--
-- Restated from the LIVE definition (pg_get_functiondef, prod, 2026-09-04);
-- the one predicate is the only change. CREATE OR REPLACE keeps the ACL.
-- =============================================================================

create or replace function public.sync_venue_coaches_group(p_venue_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_group  uuid;
  v_person uuid;
begin
  if p_venue_id is null then
    return;
  end if;

  -- A retired venue's group is frozen: nobody joins, nobody is walked out,
  -- the history stays exactly as it was. See the header, §4.
  if not exists (select 1 from public.venues where id = p_venue_id and active) then
    return;
  end if;

  v_group := public.ensure_venue_coaches_group(p_venue_id);
  if v_group is null then
    return;
  end if;

  -- OUT: anyone the SYNC seated (basis 'staff') who no longer coaches a team
  -- here. Hand-added members ('member'), creators and oversight keep their
  -- seats — the sync only takes back the chairs it put out. `not exists`
  -- rather than `not in`, because `not in` against a set that could contain a
  -- null is a trap this repo has already fallen into once (DECISIONS.md, the
  -- SG-1 NULL-comparison defects).
  update public.conversation_participants p
     set left_at = now()
   where p.conversation_id = v_group
     and p.left_at is null
     and p.basis = 'staff'
     and not exists (
       select 1 from public.venue_coach_person_ids(p_venue_id) c(person_id)
        where c.person_id = p.person_id);

  -- IN: one at a time, and tolerant. A messaging rule refusing a join must
  -- never fail the thing that triggered this — a Full-Time import, a team
  -- sheet, an admin setting a home pitch. That is how
  -- `sync_referees_group_member()` was written (20260825320000) and the reason
  -- has not changed. It is audited, so a refusal is findable.
  for v_person in
    select c.person_id from public.venue_coach_person_ids(p_venue_id) c(person_id)
    except
    select p.person_id from public.conversation_participants p
     where p.conversation_id = v_group and p.left_at is null
  loop
    begin
      insert into public.conversation_participants (conversation_id, person_id, basis)
      values (v_group, v_person, 'staff');
    exception when others then
      perform public.write_audit(
        'venue_coaches_group.join_refused', 'conversations', v_group::text,
        jsonb_build_object('venue_id', p_venue_id, 'person_id', v_person, 'error', sqlerrm));
    end;
  end loop;
end;
$function$;
