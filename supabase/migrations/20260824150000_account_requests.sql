-- =============================================================================
-- Gap 4 (post-P3.4) — self-registration with an approval queue
-- =============================================================================
-- The Neon app had /register (name, email, password, role, team → inactive
-- user) and /admin/approvals. Here an account is a Supabase Auth sign-up:
-- handle_new_user() creates the person + a `member` profile. What was missing:
--
--   1. Sign-up did not record the date of birth, so SG-10 (minimum account
--      age, guardian consent for minors) could not fire for a self-registered
--      account. handle_new_user() now reads `dob` and `phone` from the sign-up
--      metadata; the existing profiles SG-10 trigger then refuses an
--      under-age or unconsented minor's profile, which aborts the sign-up.
--   2. `account_requests`: "I am a coach / parent / player for team X". The
--      person creates one (self-insert), admins approve or reject. Approval
--      is a SECURITY DEFINER function that does the right thing per role:
--      coach/assistant/manager → team_memberships (SG-6 guard applies, so a
--      missing DBS refuses loudly and the request stays pending with the
--      reason recorded); player → team_memberships role player; parent →
--      `parent` app role only (children are linked through guardianships,
--      gap 9). Every decision is audited.
--   3. Data fix: imported Neon training sessions were kind 'block' because
--      'training' did not exist yet; retag them.
--
-- Rollback: drop function approve_account_request, reject_account_request;
-- drop table account_requests; re-create handle_new_user from
-- 20260824000000; update bookings set kind='block' where legacy_neon_ref like 'training:%'.
-- =============================================================================


-- 1. handle_new_user(): honour dob + phone from sign-up metadata ---------------
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

  -- Self-registration carries the date of birth so SG-10 can be applied at
  -- the profile insert below. An unparseable value is treated as unknown.
  begin
    v_dob := nullif(btrim(new.raw_user_meta_data ->> 'dob'), '')::date;
  exception when others then
    v_dob := null;
  end;
  if v_dob is not null and v_dob > current_date then
    v_dob := null;
  end if;
  v_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');

  insert into public.people (first_name, last_name, email, dob, phone)
  values (v_names.first_name, v_names.last_name, v_email, v_dob, v_phone)
  returning id into v_person;

  insert into profiles (id, role, full_name, person_id)
  values (new.id, 'member', new.raw_user_meta_data ->> 'full_name', v_person)
  on conflict (id) do nothing;
  return new;
end $function$;


-- 2. account_requests ------------------------------------------------------------
create type public.account_request_status as enum ('pending', 'approved', 'rejected', 'withdrawn');

create table public.account_requests (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.people (id) on delete cascade,
  requested_role  text not null check (requested_role in ('coach', 'assistant_coach', 'manager', 'player', 'parent')),
  team_id         uuid references public.teams (id) on delete set null,
  message         text,
  status          public.account_request_status not null default 'pending',
  decided_by      uuid references auth.users (id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint account_requests_team_for_team_roles
    check (requested_role = 'parent' or team_id is not null)
);
create index account_requests_pending_idx on public.account_requests (created_at) where status = 'pending';
create unique index account_requests_one_open_idx
  on public.account_requests (person_id, requested_role, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'pending';
create trigger trg_account_requests_updated
  before update on public.account_requests
  for each row execute function public.set_updated_at();
comment on table public.account_requests is
  'Self-registration follow-up: "I am a coach/player/parent for team X", approved or rejected by a club_admin. Replaces the Neon approvals queue.';

alter table public.account_requests enable row level security;
create policy "account_requests_self_read" on public.account_requests for select to authenticated
  using (person_id = public.current_person_id());
create policy "account_requests_self_insert" on public.account_requests for insert to authenticated
  with check (person_id = public.current_person_id() and status = 'pending' and decided_by is null);
create policy "account_requests_self_withdraw" on public.account_requests for update to authenticated
  using (person_id = public.current_person_id() and status = 'pending')
  with check (person_id = public.current_person_id() and status = 'withdrawn');
create policy "account_requests_admin_read" on public.account_requests for select to authenticated
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
revoke all privileges on public.account_requests from anon, authenticated, service_role;
grant select, insert, update on public.account_requests to authenticated;
grant select, insert, update, delete on public.account_requests to service_role;

-- Decisions go through functions so the side effects and the audit row are
-- one unit. Admins have no direct UPDATE policy on purpose.
create or replace function public.approve_account_request(p_request_id uuid, p_note text default null)
  returns table (outcome text, detail text)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r        public.account_requests%rowtype;
  v_season uuid;
  v_err    text;
begin
  if not public.is_club_admin() then
    raise exception 'account_requests: only a club administrator can approve' using errcode = '42501';
  end if;
  select * into r from public.account_requests where id = p_request_id for update;
  if not found then
    raise exception 'account_requests: no such request' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    return query select 'already_decided'::text, r.status::text;
    return;
  end if;

  if r.requested_role = 'parent' then
    insert into public.person_roles (person_id, role, notes)
    select r.person_id, 'parent', 'account request ' || r.id
    where not exists (select 1 from public.person_roles pr
                       where pr.person_id = r.person_id and pr.role = 'parent' and pr.revoked_at is null);
  else
    select id into v_season from public.seasons where is_current limit 1;
    if v_season is null then
      raise exception 'account_requests: no current season — set one on the Teams page first' using errcode = 'P0001';
    end if;
    begin
      insert into public.team_memberships (person_id, team_id, season_id, role, notes, created_by)
      select r.person_id, r.team_id, v_season, r.requested_role::public.team_role, 'account request ' || r.id, auth.uid()
      where not exists (select 1 from public.team_memberships m
                         where m.person_id = r.person_id and m.team_id = r.team_id
                           and m.season_id = v_season and m.left_at is null);
    exception when others then
      -- The SG-6 guard (missing DBS / safeguarding certificate on a team with
      -- minors) is the expected refusal. Keep the request pending and record why.
      get stacked diagnostics v_err = message_text;
      update public.account_requests
         set decision_note = left(v_err, 500)
       where id = r.id;
      return query select 'blocked'::text, v_err;
      return;
    end;
    if r.requested_role in ('coach', 'assistant_coach', 'manager') then
      insert into public.person_roles (person_id, role, notes)
      select r.person_id, 'coach', 'account request ' || r.id
      where not exists (select 1 from public.person_roles pr
                         where pr.person_id = r.person_id and pr.role = 'coach' and pr.revoked_at is null);
    end if;
  end if;

  update public.account_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = r.id;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'account_request.approve', 'account_requests', r.id::text,
          jsonb_build_object('person_id', r.person_id, 'role', r.requested_role, 'team_id', r.team_id));
  return query select 'approved'::text, null::text;
end
$$;

create or replace function public.reject_account_request(p_request_id uuid, p_note text default null)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r public.account_requests%rowtype;
begin
  if not public.is_club_admin() then
    raise exception 'account_requests: only a club administrator can reject' using errcode = '42501';
  end if;
  select * into r from public.account_requests where id = p_request_id for update;
  if not found then
    raise exception 'account_requests: no such request' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    return;
  end if;
  update public.account_requests
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = r.id;
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'account_request.reject', 'account_requests', r.id::text,
          jsonb_build_object('person_id', r.person_id, 'role', r.requested_role, 'team_id', r.team_id));
end
$$;

revoke all privileges on function public.approve_account_request(uuid, text) from public, anon;
revoke all privileges on function public.reject_account_request(uuid, text) from public, anon;
grant execute on function public.approve_account_request(uuid, text) to authenticated, service_role;
grant execute on function public.reject_account_request(uuid, text) to authenticated, service_role;


-- 3. Data fix: imported training sessions get the training kind ----------------
update public.bookings
   set kind = 'training'
 where legacy_neon_ref like 'training:%' and kind = 'block';
