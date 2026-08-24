-- =============================================================================
-- Join-the-club flow (Adam, 2026-08-24)
-- =============================================================================
-- "A registration page: the player / parent (might be both) registers
--  themselves (name, DOB, email, address), then up to 6 people. More than one
--  becomes a family membership. Health questions and an emergency contact for
--  every player. Team choice per player, or divert to the waiting list."
--
-- What the wizard needs from the database:
--   1. Address at sign-up: handle_new_user() now reads `address` (an object)
--      from the sign-up metadata, alongside dob/phone.
--   2. update_own_contact(): a signed-in person may correct their own
--      address/phone/preferred name (people UPDATE is otherwise admin-only).
--   3. add_household_adult(): the registrant may create another ADULT in
--      their household (a spouse who will not have a login). Mirrors
--      add_child(): caller must be a known adult; the new person must be an
--      adult; audited. No guardianship, no login, no roles.
--   4. registrations_guard(): a new INSERT branch — you may also register a
--      person you created who has no login of their own (the household
--      adult). Children stay guardian-only; strangers stay refused.
--   5. memberships (+ membership_people): one row per registration submission
--      — kind 'individual' when it covers one person, 'family' for more.
--      Created only through create_membership(), which verifies every listed
--      person is the caller, their guarded child, or a household member they
--      created. club_admin reads and decides; the primary reads their own.
--
-- The 6-person cap, the health questions and the waiting-list divert are the
-- wizard's job (registrations.form v1 carries health + emergency contact;
-- submit_waiting_list_entry() already exists for the divert).
--
-- Rollback: restore handle_new_user from 20260824150000 and
-- registrations_guard from 20260823130000; drop function update_own_contact,
-- add_household_adult, create_membership; drop table membership_people,
-- memberships; drop type membership_kind.
-- =============================================================================


-- 1. handle_new_user(): + address --------------------------------------------
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_names       record;
  v_email       text;
  v_person      uuid;
  v_meta_person text;
  v_invited     uuid;
  v_invited_row public.people%rowtype;
  v_dob         date;
  v_phone       text;
  v_address     jsonb;
begin
  v_meta_person := new.raw_user_meta_data ->> 'person_id';
  if v_meta_person is not null
     and v_meta_person ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    v_invited := v_meta_person::uuid;
    select * into v_invited_row from public.people p where p.id = v_invited and p.deleted_at is null;
    if found
       and not exists (select 1 from public.profiles pr where pr.person_id = v_invited)
       and (
            public.has_active_consent(v_invited, 'app_account'::public.consent_type)
            or (
              not (v_invited_row.dob is not null and public.is_minor_dob(v_invited_row.dob))
              and v_invited_row.email is not null
              and lower(v_invited_row.email) = lower(new.email)
            )
       )
    then
      insert into profiles (id, role, full_name, person_id)
      values (new.id, 'member',
              coalesce(new.raw_user_meta_data ->> 'full_name', v_invited_row.first_name || ' ' || v_invited_row.last_name),
              v_invited)
      on conflict (id) do nothing;
      return new;
    end if;
  end if;

  select s.first_name, s.last_name
    into v_names
    from public.split_person_name(new.raw_user_meta_data ->> 'full_name') s;

  v_email := nullif(btrim(new.email), '');
  if v_email is not null
     and (
       length(v_email) not between 6 and 320
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or exists (
            select 1 from public.people pe
             where pe.deleted_at is null
               and lower(pe.email) = lower(v_email)
          )
     )
  then
    v_email := null;
  end if;

  begin
    v_dob := nullif(btrim(new.raw_user_meta_data ->> 'dob'), '')::date;
  exception when others then
    v_dob := null;
  end;
  if v_dob is not null and v_dob > current_date then
    v_dob := null;
  end if;
  v_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');

  -- The join wizard sends the home address at sign-up. Only an object is
  -- accepted; anything else is treated as absent.
  v_address := case when jsonb_typeof(new.raw_user_meta_data -> 'address') = 'object'
                    then new.raw_user_meta_data -> 'address' end;

  insert into public.people (first_name, last_name, email, dob, phone, address)
  values (v_names.first_name, v_names.last_name, v_email, v_dob, v_phone, v_address)
  returning id into v_person;

  insert into profiles (id, role, full_name, person_id)
  values (new.id, 'member', new.raw_user_meta_data ->> 'full_name', v_person)
  on conflict (id) do nothing;
  return new;
end $function$;


-- 2. update_own_contact() ------------------------------------------------------
create or replace function public.update_own_contact(
  p_address jsonb default null, p_phone text default null, p_preferred_name text default null
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
         preferred_name = coalesce(nullif(btrim(p_preferred_name), ''), preferred_name)
   where id = v_me and deleted_at is null;
end $$;
revoke all privileges on function public.update_own_contact(jsonb, text, text) from public, anon;
grant execute on function public.update_own_contact(jsonb, text, text) to authenticated;


-- 3. add_household_adult() -------------------------------------------------------
create or replace function public.add_household_adult(
  p_first_name text, p_last_name text, p_dob date,
  p_email text default null, p_phone text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me     uuid := public.current_person_id();
  v_my_dob date;
  v_new    uuid;
begin
  if v_me is null then
    raise exception 'add_household_adult: no person is linked to this login' using errcode = '42501';
  end if;
  select dob into v_my_dob from public.people where id = v_me;
  if v_my_dob is null or public.is_minor_dob(v_my_dob) then
    raise exception 'add_household_adult: only a known adult can add household members [SAFEGUARDING.md SG-4]'
      using errcode = 'P0001';
  end if;
  if p_dob is null or p_dob > current_date then
    raise exception 'add_household_adult: a valid date of birth is required' using errcode = 'P0001';
  end if;
  if public.is_minor_dob(p_dob) then
    raise exception 'add_household_adult: % is a minor — add children with add_child() so a guardianship is recorded [SAFEGUARDING.md SG-4]',
      btrim(p_first_name) using errcode = 'P0001';
  end if;

  insert into public.people (first_name, last_name, dob, email, phone, created_by)
  values (btrim(p_first_name), btrim(p_last_name), p_dob,
          nullif(lower(btrim(p_email)), ''), nullif(btrim(p_phone), ''), auth.uid())
  returning id into v_new;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'family.adult_added', 'people', v_new::text,
          jsonb_build_object('added_by_person_id', v_me));
  return v_new;
end $$;
revoke all privileges on function public.add_household_adult(text, text, date, text, text) from public, anon;
grant execute on function public.add_household_adult(text, text, date, text, text) to authenticated;


-- 4. registrations_guard(): the household-adult branch ---------------------------
create or replace function public.registrations_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_caller uuid := public.current_person_id();
  v_admin  boolean := public.is_club_admin();
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' and not v_admin and auth.uid() is not null then
      raise exception 'registrations: a new registration starts as pending' using errcode = 'P0001';
    end if;
    if new.submitted_by is null then
      new.submitted_by := auth.uid();
    end if;
    if auth.uid() is not null and not v_admin then
      if public.is_minor(new.person_id) then
        if not exists (
          select 1 from public.guardianships g
          where g.child_person_id = new.person_id
            and g.guardian_person_id = v_caller
            and g.ended_at is null)
        then
          raise exception
            'registrations: a minor may be registered only by an active guardian or a club_admin [SAFEGUARDING.md SG-4]'
            using errcode = 'P0001';
        end if;
      elsif new.person_id is distinct from v_caller then
        -- 20260824280000: an adult HOUSEHOLD member — created by this login
        -- and holding no login of their own — may be registered by whoever
        -- created them (the join wizard's spouse case). Anyone else: refused.
        if not public.is_household_member_of(new.person_id) then
          raise exception 'registrations: an adult registers themself (or a club_admin does it for them)'
            using errcode = 'P0001';
        end if;
      end if;
    end if;
    return new;
  end if;
  -- UPDATE
  if new.person_id <> old.person_id or new.season_id <> old.season_id
     or new.submitted_by is distinct from old.submitted_by or new.submitted_at <> old.submitted_at then
    raise exception 'registrations: person, season and submission are immutable' using errcode = 'P0001';
  end if;
  if new.status <> old.status then
    if old.status in ('rejected', 'withdrawn') then
      raise exception 'registrations: a % registration is final; submit a new one', old.status using errcode = 'P0001';
    end if;
    if new.status = 'pending' then
      raise exception 'registrations: cannot return to pending' using errcode = 'P0001';
    end if;
    if new.status in ('approved', 'rejected') and not v_admin and auth.uid() is not null then
      raise exception 'registrations: only a club_admin may approve or reject' using errcode = 'P0001';
    end if;
    if new.status = 'withdrawn' and not v_admin and auth.uid() is not null then
      if not (new.person_id = v_caller
              or exists (select 1 from public.guardianships g
                         where g.child_person_id = new.person_id
                           and g.guardian_person_id = v_caller and g.ended_at is null))
      then
        raise exception 'registrations: only the subject, an active guardian or a club_admin may withdraw'
          using errcode = 'P0001';
      end if;
    end if;
    new.decided_at := now();
    new.decided_by := auth.uid();

    -- Approval with a team: create the live player membership for the season.
    -- P2.1's SG-6 guard runs here and may refuse, which fails the approval.
    if new.status = 'approved' and new.team_id is not null
       and not exists (select 1 from public.team_memberships m
                       where m.person_id = new.person_id and m.team_id = new.team_id
                         and m.season_id = new.season_id and m.role = 'player' and m.left_at is null)
    then
      insert into public.team_memberships (person_id, team_id, season_id, role, created_by)
      values (new.person_id, new.team_id, new.season_id, 'player', auth.uid());
    end if;
  elsif (new.decided_at is distinct from old.decided_at or new.decided_by is distinct from old.decided_by) then
    raise exception 'registrations: decided_at/decided_by are set by the status change' using errcode = 'P0001';
  end if;

  return new;
end;
$$;


-- 5. memberships -------------------------------------------------------------------
create type public.membership_kind as enum ('individual', 'family');

create table public.memberships (
  id                 uuid primary key default gen_random_uuid(),
  season_id          uuid not null references public.seasons (id) on delete restrict,
  primary_person_id  uuid not null references public.people (id) on delete restrict,
  kind               public.membership_kind not null,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id) on delete set null,
  unique (season_id, primary_person_id)
);
create table public.membership_people (
  membership_id uuid not null references public.memberships (id) on delete cascade,
  person_id     uuid not null references public.people (id) on delete cascade,
  primary key (membership_id, person_id)
);
comment on table public.memberships is
  'One row per join-wizard submission: individual (one person) or family (two to six). The registrations rows carry the detail; this records what kind of membership was asked for.';

alter table public.memberships enable row level security;
alter table public.membership_people enable row level security;
create policy "memberships_self_read" on public.memberships for select to authenticated
  using (primary_person_id = public.current_person_id()
         or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
create policy "membership_people_read" on public.membership_people for select to authenticated
  using (exists (select 1 from public.memberships m
                 where m.id = membership_id
                   and (m.primary_person_id = public.current_person_id()
                        or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]))));
revoke all privileges on public.memberships, public.membership_people from anon, authenticated, service_role;
grant select on public.memberships, public.membership_people to authenticated;
grant select, insert, update, delete on public.memberships, public.membership_people to service_role;

create or replace function public.create_membership(p_person_ids uuid[])
  returns table (membership_id uuid, kind public.membership_kind)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me     uuid := public.current_person_id();
  v_season uuid;
  v_kind   public.membership_kind;
  v_id     uuid;
  v_pid    uuid;
  v_ids    uuid[];
begin
  if v_me is null then
    raise exception 'create_membership: no person is linked to this login' using errcode = '42501';
  end if;
  select id into v_season from public.seasons where is_current limit 1;
  if v_season is null then
    raise exception 'create_membership: no current season is set' using errcode = 'P0001';
  end if;

  -- The registrant is always included; duplicates collapse; cap at six.
  v_ids := (select array_agg(distinct pid) from unnest(p_person_ids || v_me) as pid);
  if array_length(v_ids, 1) > 6 then
    raise exception 'create_membership: a family membership covers at most six people' using errcode = 'P0001';
  end if;

  -- Every listed person must be the caller, their guarded child, or a
  -- household member this login created (no login of their own).
  foreach v_pid in array v_ids loop
    if v_pid = v_me then continue; end if;
    if exists (select 1 from public.guardianships g
               where g.child_person_id = v_pid and g.guardian_person_id = v_me and g.ended_at is null) then
      continue;
    end if;
    if exists (select 1 from public.people p
               where p.id = v_pid and p.created_by = auth.uid() and p.deleted_at is null
                 and not exists (select 1 from public.profiles pr where pr.person_id = p.id)) then
      continue;
    end if;
    raise exception 'create_membership: % is not in your household', v_pid using errcode = 'P0001';
  end loop;

  v_kind := case when array_length(v_ids, 1) > 1 then 'family' else 'individual' end::public.membership_kind;

  insert into public.memberships (season_id, primary_person_id, kind, created_by)
  values (v_season, v_me, v_kind, auth.uid())
  on conflict (season_id, primary_person_id)
    do update set kind = excluded.kind
  returning id into v_id;

  delete from public.membership_people where membership_people.membership_id = v_id;
  insert into public.membership_people (membership_id, person_id)
  select v_id, pid from unnest(v_ids) as pid;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'membership.submitted', 'memberships', v_id::text,
          jsonb_build_object('kind', v_kind, 'people', v_ids, 'season_id', v_season));

  return query select v_id, v_kind;
end $$;
revoke all privileges on function public.create_membership(uuid[]) from public, anon;
grant execute on function public.create_membership(uuid[]) to authenticated;


-- 6. The matching INSERT policy for household adults --------------------------------
-- The guard's new branch runs only after RLS lets the row in; this is the RLS
-- half of the same rule. SECURITY DEFINER because a policy subquery runs under
-- the caller's own RLS, and a creator holds no people read policy.
create or replace function public.is_household_member_of(p_person_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.people p
    where p.id = p_person_id
      and p.created_by = auth.uid()
      and p.deleted_at is null
      and not exists (select 1 from public.profiles pr where pr.person_id = p.id));
$$;
revoke all privileges on function public.is_household_member_of(uuid) from public, anon;
grant execute on function public.is_household_member_of(uuid) to authenticated, service_role;

create policy "registrations_household_insert" on public.registrations for insert to authenticated
  with check (public.is_household_member_of(person_id));
