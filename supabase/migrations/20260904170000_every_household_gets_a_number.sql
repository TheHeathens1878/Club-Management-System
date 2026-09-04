-- =============================================================================
-- Every household gets a number (Adam, 2026-09-04)
--
-- "Membership should always be at the lead member (bill-payer)… The app should
--  also issue electronic membership cards to the lead member and all
--  sub-members share that membership number. 5 digit membership number e.g
--  00001A with sub members being 00001B C and so on. William Blandamer is
--  00001A and Adam Wareing is 00002A with Adam's related contacts being 00002B
--  (Stephanie Jones), 00002C (Benjamin Wareing) and 00002D (Matthew Wareing).
--  All other memberships issued by alphabetical order. Future members to be
--  sequential."
--
-- WHAT THIS IS, AND WHAT IT IS NOT
--   `billing_accounts` is the club's billing spine: one row per bill-paying
--   household, held by an adult lead (the bill-payer), carrying the permanent
--   membership number. It is NOT `memberships` (20260824280000) — that table
--   records what a join-wizard submission asked for, per season, and stays
--   untouched. A number outlives seasons; a person keeps their card letter for
--   life of the account.
--
--   * `billing_accounts` — member_no (1..99999, rendered 00001), lead person
--     (unique — one account per lead), status active/lapsed/closed.
--   * `billing_account_people` — who is under the number and which letter they
--     wear. The lead is always 'A'. Letters are issued B, C, D… in the order
--     people are added and are NEVER reused or reassigned: a card that has
--     been issued stays true. Removal is soft (`removed_at`); the letter stays
--     reserved.
--   * One LIVE account membership per person (partial unique) — a person's
--     card resolves to one number.
--
-- NUMBER ISSUE
--   `next_member_no()` is max+1 under an advisory xact lock — sequential with
--   no gaps burnt by rollbacks (a sequence would leak numbers on error, and
--   membership numbers are a public-facing series).
--   * `create_billing_account(lead, member_no default null)` — explicit number
--     for the seeded anchors, max+1 otherwise.
--   * `add_person_to_billing_account(account, person)` — next unused letter.
--   * `remove_person_from_billing_account(account, person)` — soft, never the
--     lead.
--   * `preview_membership_numbering()` / `issue_membership_numbers(leads[])` —
--     the batch. The preview derives each un-numbered household (adult lead +
--     household-linked adults + guarded children, in that order, matching the
--     00002 example: linked adults then children, each alphabetical) and says
--     WHY each lead qualifies, so the Finance screen can show it and let the
--     treasurer untick test rows before issuing. Issue numbers in alphabetical
--     order of lead (last name, first name) regardless of the array order it
--     was handed.
--
-- WHO COUNTS AS A MEMBER (for the batch only — a number can always be issued
-- by hand): a live `member` role, a live registration (pending/approved), a
-- live player squad row, or being lead contact of a `memberships` submission.
-- The union is deliberately generous; the preview is what makes it safe.
--
-- SEEDED ANCHORS (data touched — production only, by person id with a
-- name+email fallback, skipped with a NOTICE on databases where those people
-- do not exist): 00001 William Blandamer; 00002 Adam Wareing with Stephanie
-- Jones B, Benjamin Wareing C, Matthew Wareing D. Exactly as dictated.
--
-- RLS
--   Read: finance (club_admin or the new `finance` role) sees all; a person
--   sees their own household's account and its people — the two-way
--   click-through (contact → lead, lead → everyone under the number) is this
--   policy. Write: through the SECURITY DEFINER functions (gated on
--   `is_finance()` when a JWT is present) — no direct write policies at all.
--   SG-2 treatment: hard deletes and truncate denied on both tables; an
--   account closes (`status = 'closed'`), a person is soft-removed. Financial
--   history hangs off these rows in the next migration and must not lose its
--   spine.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (two new tables, policies
-- written with them); data touched: YES — five prod people are seeded into the
-- two anchor accounts above; rollback: §9 at the foot of this file.
-- =============================================================================


-- =============================================================================
-- 1. is_finance() — the gate for everything financial
-- =============================================================================

create or replace function public.is_finance()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select public.has_any_role(array['club_admin', 'finance']::public.app_role[]);
$$;

revoke all privileges on function public.is_finance() from public, anon;
grant execute on function public.is_finance() to authenticated, service_role;

comment on function public.is_finance() is 'club_admin or the dedicated finance role — the one gate for the finance section.';


-- =============================================================================
-- 2. TABLES
-- =============================================================================

create type public.billing_account_status as enum ('active', 'lapsed', 'closed');

create table public.billing_accounts (
  id              uuid primary key default gen_random_uuid(),
  member_no       integer not null unique check (member_no between 1 and 99999),
  lead_person_id  uuid not null unique references public.people (id) on delete restrict,
  status          public.billing_account_status not null default 'active',
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

create table public.billing_account_people (
  account_id  uuid not null references public.billing_accounts (id) on delete restrict,
  person_id   uuid not null references public.people (id) on delete restrict,
  letter      text not null check (letter ~ '^[A-Z]$'),
  added_at    timestamptz not null default now(),
  added_by    uuid references auth.users (id) on delete set null,
  removed_at  timestamptz,
  primary key (account_id, person_id),
  unique (account_id, letter)
);

-- One live account per person: their card resolves to exactly one number.
create unique index billing_account_people_one_live_idx
  on public.billing_account_people (person_id) where removed_at is null;

create index billing_account_people_account_idx on public.billing_account_people (account_id);

create trigger trg_billing_accounts_updated
  before update on public.billing_accounts
  for each row execute function public.set_updated_at();

comment on table public.billing_accounts is
  'One row per bill-paying household: the permanent membership number, held by the adult lead (bill-payer). Seasons come and go; the number stays.';
comment on table public.billing_account_people is
  'Who is under a membership number and which letter they wear. Lead = A. Letters are never reused; removal is soft.';

-- SG-2 treatment: the billing spine is never hard-deleted or truncated.
create trigger trg_billing_accounts_no_delete
  before delete on public.billing_accounts
  for each row execute function public.deny_hard_delete();
create trigger trg_billing_accounts_no_truncate
  before truncate on public.billing_accounts
  for each statement execute function public.deny_truncate();
create trigger trg_billing_account_people_no_delete
  before delete on public.billing_account_people
  for each row execute function public.deny_hard_delete();
create trigger trg_billing_account_people_no_truncate
  before truncate on public.billing_account_people
  for each statement execute function public.deny_truncate();


-- =============================================================================
-- 3. GUARDS
-- =============================================================================

-- The lead is an adult with a known date of birth (the bill-payer signs real
-- agreements), and a live person. Same standard subscriptions_guard() set for
-- payers in 20260823170000.
create or replace function public.billing_accounts_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_dob date;
  v_deleted timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.member_no <> old.member_no then
      raise exception 'billing_accounts: a membership number, once issued, is never changed' using errcode = 'P0001';
    end if;
    if new.lead_person_id <> old.lead_person_id then
      raise exception 'billing_accounts: the lead cannot be swapped — close the account and issue a new one' using errcode = 'P0001';
    end if;
    return new;
  end if;

  select dob, deleted_at into v_dob, v_deleted from public.people where id = new.lead_person_id;
  if not found or v_deleted is not null then
    raise exception 'billing_accounts: no such live person to lead the account' using errcode = 'P0001';
  end if;
  if v_dob is null or public.is_minor_dob(v_dob) then
    raise exception 'billing_accounts: the lead member (bill-payer) must be an adult with a known date of birth' using errcode = 'P0001';
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;

create trigger trg_billing_accounts_guard
  before insert or update on public.billing_accounts
  for each row execute function public.billing_accounts_guard();

create or replace function public.billing_account_people_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_lead uuid;
begin
  select lead_person_id into v_lead from public.billing_accounts where id = new.account_id;

  if tg_op = 'UPDATE' then
    if new.account_id <> old.account_id or new.person_id <> old.person_id or new.letter <> old.letter then
      raise exception 'billing_account_people: account, person and letter are immutable — a card that has been issued stays true' using errcode = 'P0001';
    end if;
    if new.removed_at is not null and new.person_id = v_lead then
      raise exception 'billing_account_people: the lead member cannot be removed from their own account' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if exists (select 1 from public.people p where p.id = new.person_id and p.deleted_at is not null) then
    raise exception 'billing_account_people: cannot add a deleted person to an account' using errcode = 'P0001';
  end if;
  if (new.person_id = v_lead) <> (new.letter = 'A') then
    raise exception 'billing_account_people: the lead member wears letter A, and only the lead wears it' using errcode = 'P0001';
  end if;
  new.added_by := coalesce(new.added_by, auth.uid());
  return new;
end;
$$;

create trigger trg_billing_account_people_guard
  before insert or update on public.billing_account_people
  for each row execute function public.billing_account_people_guard();


-- =============================================================================
-- 4. NUMBER + LETTER ISSUE
-- =============================================================================

-- max+1 under an advisory xact lock: sequential, gap-free (a sequence burns
-- numbers on rollback, and this series appears on printed cards).
create or replace function public.next_member_no()
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v integer;
begin
  perform pg_advisory_xact_lock(hashtext('billing_accounts.member_no'));
  select coalesce(max(member_no), 0) + 1 into v from public.billing_accounts;
  if v > 99999 then
    raise exception 'billing_accounts: the five-digit series is exhausted' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

create or replace function public.create_billing_account(
  p_lead_person_id uuid,
  p_member_no integer default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_id uuid;
  v_no integer;
begin
  if auth.uid() is not null and not public.is_finance() then
    raise exception 'create_billing_account: finance or club_admin only' using errcode = '42501';
  end if;
  if exists (select 1 from public.billing_account_people bap
              where bap.person_id = p_lead_person_id and bap.removed_at is null) then
    raise exception 'create_billing_account: this person is already under a membership number' using errcode = 'P0001';
  end if;
  v_no := coalesce(p_member_no, public.next_member_no());
  insert into public.billing_accounts (member_no, lead_person_id)
  values (v_no, p_lead_person_id)
  returning id into v_id;
  insert into public.billing_account_people (account_id, person_id, letter)
  values (v_id, p_lead_person_id, 'A');
  perform public.write_audit('membership_number.issued', 'billing_accounts', v_id::text,
    jsonb_build_object('member_no', v_no, 'lead_person_id', p_lead_person_id));
  return v_id;
end;
$$;

create or replace function public.add_person_to_billing_account(
  p_account_id uuid,
  p_person_id uuid
)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_letter text;
begin
  if auth.uid() is not null and not public.is_finance() then
    raise exception 'add_person_to_billing_account: finance or club_admin only' using errcode = '42501';
  end if;
  -- Re-adding someone soft-removed from THIS account gives their old letter back.
  update public.billing_account_people
     set removed_at = null
   where account_id = p_account_id and person_id = p_person_id and removed_at is not null
  returning letter into v_letter;
  if found then
    return v_letter;
  end if;
  if exists (select 1 from public.billing_account_people bap
              where bap.person_id = p_person_id and bap.removed_at is null) then
    raise exception 'add_person_to_billing_account: this person is already under a membership number' using errcode = 'P0001';
  end if;
  select chr(c) into v_letter
    from generate_series(ascii('B'), ascii('Z')) as c
   where not exists (select 1 from public.billing_account_people bap
                      where bap.account_id = p_account_id and bap.letter = chr(c))
   order by c
   limit 1;
  if v_letter is null then
    raise exception 'add_person_to_billing_account: account is full (letters B–Z all issued)' using errcode = 'P0001';
  end if;
  insert into public.billing_account_people (account_id, person_id, letter)
  values (p_account_id, p_person_id, v_letter);
  perform public.write_audit('membership_number.person_added', 'billing_accounts', p_account_id::text,
    jsonb_build_object('person_id', p_person_id, 'letter', v_letter));
  return v_letter;
end;
$$;

create or replace function public.remove_person_from_billing_account(
  p_account_id uuid,
  p_person_id uuid
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_finance() then
    raise exception 'remove_person_from_billing_account: finance or club_admin only' using errcode = '42501';
  end if;
  update public.billing_account_people
     set removed_at = now()
   where account_id = p_account_id and person_id = p_person_id and removed_at is null;
  if not found then
    raise exception 'remove_person_from_billing_account: no live row for that person on that account' using errcode = 'P0001';
  end if;
  perform public.write_audit('membership_number.person_removed', 'billing_accounts', p_account_id::text,
    jsonb_build_object('person_id', p_person_id));
end;
$$;

-- The printed form: '00002C'. SECURITY INVOKER on purpose — it reads
-- billing_account_people under the caller's own RLS, so it answers for people
-- whose account you can see and returns NULL for everyone else.
create or replace function public.member_card_ref(p_person_id uuid)
  returns text
  language sql
  stable
  set search_path = public
as $$
  select lpad(a.member_no::text, 5, '0') || bap.letter
    from public.billing_account_people bap
    join public.billing_accounts a on a.id = bap.account_id
   where bap.person_id = p_person_id and bap.removed_at is null;
$$;

revoke all privileges on function public.next_member_no() from public, anon, authenticated;
revoke all privileges on function public.create_billing_account(uuid, integer) from public, anon;
revoke all privileges on function public.add_person_to_billing_account(uuid, uuid) from public, anon;
revoke all privileges on function public.remove_person_from_billing_account(uuid, uuid) from public, anon;
revoke all privileges on function public.member_card_ref(uuid) from public, anon;
grant execute on function public.create_billing_account(uuid, integer) to authenticated, service_role;
grant execute on function public.add_person_to_billing_account(uuid, uuid) to authenticated, service_role;
grant execute on function public.remove_person_from_billing_account(uuid, uuid) to authenticated, service_role;
grant execute on function public.member_card_ref(uuid) to authenticated, service_role;
grant execute on function public.next_member_no() to service_role;


-- =============================================================================
-- 5. THE BATCH — preview and issue, alphabetical
-- =============================================================================

-- Membership, for the purpose of the batch. Generous on purpose; the preview
-- screen is where a human unticks the noise.
create or replace function public.counts_as_club_member(p_person_id uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
    when exists (select 1 from public.person_roles pr
                  where pr.person_id = p_person_id and pr.role = 'member' and pr.revoked_at is null)
      then 'member role'
    when exists (select 1 from public.registrations r
                  where r.person_id = p_person_id and r.status in ('pending', 'approved'))
      then 'live registration'
    when exists (select 1 from public.team_memberships tm
                  where tm.person_id = p_person_id and tm.role = 'player' and tm.left_at is null)
      then 'player'
    when exists (select 1 from public.memberships m where m.primary_person_id = p_person_id)
      then 'membership submission'
    else null end;
$$;

-- The household a lead would bring with them: household-linked adults first,
-- then guarded children, each alphabetical — the order that puts Stephanie at
-- B and Benjamin and Matthew at C and D. Only people not already numbered.
create or replace function public.billing_household_for(p_lead_person_id uuid)
  returns table (person_id uuid, ord integer)
  language sql
  stable
  security definer
  set search_path = public
as $$
  with linked_adults as (
    select hl.person_id, 1 as grp, p.last_name, p.first_name
      from public.household_links hl
      join public.profiles pr on pr.id = hl.owner_user_id and pr.person_id = p_lead_person_id
      join public.people p on p.id = hl.person_id and p.deleted_at is null
  ),
  children as (
    select g.child_person_id as person_id, 2 as grp, p.last_name, p.first_name
      from public.guardianships g
      join public.people p on p.id = g.child_person_id and p.deleted_at is null
     where g.guardian_person_id = p_lead_person_id and g.ended_at is null
  ),
  all_members as (
    select * from linked_adults union select * from children
  )
  select am.person_id,
         row_number() over (order by am.grp, am.first_name, am.last_name)::integer as ord
    from all_members am
   where am.person_id <> p_lead_person_id
     and not exists (select 1 from public.billing_account_people bap
                      where bap.person_id = am.person_id and bap.removed_at is null);
$$;

-- Every un-numbered household that would get a number, alphabetical by lead.
-- plpgsql so the finance gate lives in the body: the function is DEFINER and
-- reads names club-wide, so it must refuse anyone who is not finance.
create or replace function public.preview_membership_numbering()
  returns table (
    lead_person_id uuid,
    lead_name      text,
    basis          text,
    household      jsonb
  )
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_finance() then
    raise exception 'preview_membership_numbering: finance or club_admin only' using errcode = '42501';
  end if;
  return query
  select p.id,
         p.first_name || ' ' || p.last_name,
         public.counts_as_club_member(p.id),
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'person_id', h.person_id,
                     'name', hp.first_name || ' ' || hp.last_name)
                   order by h.ord)
              from public.billing_household_for(p.id) h
              join public.people hp on hp.id = h.person_id),
           '[]'::jsonb)
    from public.people p
   where p.deleted_at is null
     and p.dob is not null and not public.is_minor_dob(p.dob)
     and not exists (select 1 from public.billing_account_people bap
                      where bap.person_id = p.id and bap.removed_at is null)
     -- not somebody else's household member
     and not exists (select 1 from public.household_links hl
                      join public.profiles pr on pr.id = hl.owner_user_id
                     where hl.person_id = p.id and pr.person_id is distinct from p.id)
     and (public.counts_as_club_member(p.id) is not null
          or exists (select 1 from public.billing_household_for(p.id) h
                      where public.counts_as_club_member(h.person_id) is not null))
   order by p.last_name, p.first_name;
end;
$$;

-- Issue for the leads handed over — ALPHABETICAL by lead name regardless of
-- array order, so the series honours "all other memberships issued by
-- alphabetical order" whatever the screen sent.
create or replace function public.issue_membership_numbers(p_lead_person_ids uuid[])
  returns table (member_no integer, lead_person_id uuid)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_lead uuid;
  v_account uuid;
  v_member record;
begin
  if auth.uid() is not null and not public.is_finance() then
    raise exception 'issue_membership_numbers: finance or club_admin only' using errcode = '42501';
  end if;
  for v_lead in
    select p.id
      from public.people p
     where p.id = any (p_lead_person_ids)
     order by p.last_name, p.first_name
  loop
    if exists (select 1 from public.billing_account_people bap
                where bap.person_id = v_lead and bap.removed_at is null) then
      continue;  -- already numbered; idempotent by construction
    end if;
    v_account := public.create_billing_account(v_lead);
    for v_member in select h.person_id from public.billing_household_for(v_lead) h order by h.ord
    loop
      perform public.add_person_to_billing_account(v_account, v_member.person_id);
    end loop;
    return query select a.member_no, a.lead_person_id
                   from public.billing_accounts a where a.id = v_account;
  end loop;
end;
$$;

revoke all privileges on function public.counts_as_club_member(uuid) from public, anon, authenticated;
revoke all privileges on function public.billing_household_for(uuid) from public, anon, authenticated;
revoke all privileges on function public.preview_membership_numbering() from public, anon;
revoke all privileges on function public.issue_membership_numbers(uuid[]) from public, anon;
grant execute on function public.counts_as_club_member(uuid) to service_role;
grant execute on function public.billing_household_for(uuid) to service_role;
grant execute on function public.preview_membership_numbering() to authenticated, service_role;
grant execute on function public.issue_membership_numbers(uuid[]) to authenticated, service_role;


-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- =============================================================================

alter table public.billing_accounts enable row level security;
alter table public.billing_account_people enable row level security;

-- SECURITY DEFINER on purpose: `billing_account_people`'s own read policy asks
-- this question, so an invoker predicate would re-enter the table's RLS to
-- evaluate itself — infinite recursion (the P1.4 lesson, again).
create or replace function public.on_billing_account(p_account_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.billing_account_people me
                  where me.account_id = p_account_id
                    and me.person_id = public.current_person_id()
                    and me.removed_at is null);
$$;
revoke all privileges on function public.on_billing_account(uuid) from public, anon;
grant execute on function public.on_billing_account(uuid) to authenticated, service_role;

-- Your household's number is yours to see — lead or sub-member, live rows on
-- the same account. Finance sees all. This is the contact ↔ lead click-through.
create policy "billing_accounts_read" on public.billing_accounts for select to authenticated
  using (public.is_finance() or public.on_billing_account(id));

create policy "billing_account_people_read" on public.billing_account_people for select to authenticated
  using (public.is_finance() or public.on_billing_account(account_id));

-- Writes go through the SECURITY DEFINER functions above; no direct write
-- policies. Finance status/notes edits get one narrow update policy.
create policy "billing_accounts_finance_update" on public.billing_accounts for update to authenticated
  using (public.is_finance()) with check (public.is_finance());


-- =============================================================================
-- 7. GRANTS
-- =============================================================================

revoke all privileges on public.billing_accounts, public.billing_account_people from anon, authenticated, service_role;
grant select, update on public.billing_accounts to authenticated;
grant select on public.billing_account_people to authenticated;
grant select, insert, update on public.billing_accounts, public.billing_account_people to service_role;
revoke all privileges on function public.billing_accounts_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.billing_account_people_guard() from public, anon, authenticated, service_role;


-- =============================================================================
-- 8. SEEDED ANCHORS (production data; NOTICE + skip elsewhere)
-- =============================================================================

do $$
declare
  v_william uuid;
  v_adam    uuid;
  v_steph   uuid;
  v_ben     uuid;
  v_matt    uuid;
  v_account uuid;
begin
  -- Resolve by id first (the prod rows), fall back to name+email so a
  -- rehearsal branch cloned from prod matches the same five people.
  select id into v_william from public.people where id = '1e073f5a-f42f-42bb-9049-6d6fcb1a1774' and deleted_at is null;
  if v_william is null then
    select id into v_william from public.people
     where first_name = 'William' and last_name = 'Blandamer' and deleted_at is null
     order by created_at limit 1;
  end if;

  select id into v_adam from public.people where id = '297f4934-e7ce-4672-9c78-cd2b6ea4bc43' and deleted_at is null;
  if v_adam is null then
    select id into v_adam from public.people
     where first_name = 'Adam' and last_name = 'Wareing' and lower(email) = 'adam@aomsportsclub.co.uk' and deleted_at is null
     order by created_at limit 1;
  end if;

  select id into v_steph from public.people where id = 'd4d65032-b174-4e2e-abed-91acbc7fa2d1' and deleted_at is null;
  select id into v_ben   from public.people where id = '5d722772-7249-4c77-a473-ac72e213c502' and deleted_at is null;
  select id into v_matt  from public.people where id = 'f57c4359-ecf9-4ef8-b73e-c0d36c53b33e' and deleted_at is null;

  if v_william is not null
     and not exists (select 1 from public.billing_account_people bap
                      where bap.person_id = v_william and bap.removed_at is null)
     and not exists (select 1 from public.billing_accounts a where a.member_no = 1) then
    perform public.create_billing_account(v_william, 1);
    raise notice 'membership numbers: 00001A issued to William Blandamer (%)', v_william;
  elsif v_william is null then
    raise notice 'membership numbers: William Blandamer not found — 00001 not seeded on this database';
  end if;

  if v_adam is not null
     and not exists (select 1 from public.billing_account_people bap
                      where bap.person_id = v_adam and bap.removed_at is null)
     and not exists (select 1 from public.billing_accounts a where a.member_no = 2) then
    v_account := public.create_billing_account(v_adam, 2);
    raise notice 'membership numbers: 00002A issued to Adam Wareing (%)', v_adam;
    -- B, C, D in dictated order: Stephanie, Benjamin, Matthew.
    if v_steph is not null then perform public.add_person_to_billing_account(v_account, v_steph); end if;
    if v_ben   is not null then perform public.add_person_to_billing_account(v_account, v_ben);   end if;
    if v_matt  is not null then perform public.add_person_to_billing_account(v_account, v_matt);  end if;
  elsif v_adam is null then
    raise notice 'membership numbers: Adam Wareing (adam@aomsportsclub.co.uk) not found — 00002 not seeded on this database';
  end if;
end $$;

notify pgrst, 'reload schema';


-- =============================================================================
-- 9. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop function issue_membership_numbers, preview_membership_numbering,
-- billing_household_for,
-- counts_as_club_member, member_card_ref, remove_person_from_billing_account,
-- add_person_to_billing_account, create_billing_account, next_member_no,
-- billing_account_people_guard, billing_accounts_guard, is_finance;
-- drop table billing_account_people, billing_accounts;
-- drop type billing_account_status.
