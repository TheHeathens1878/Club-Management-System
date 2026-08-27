-- =============================================================================
-- The adult you connected is one you can correct
-- =============================================================================
-- Adam, 2026-08-26: "In connect adults … We should be able to edit details
-- also."
--
-- Until now the page said "Corrections to their record go through the club —
-- ask a club administrator", for a record the member typed in themselves
-- minutes earlier. A mistyped email on a login-less household adult could only
-- be fixed by an administrator, and a mistyped email is exactly what stops
-- that person ever being matched to their own login later.
--
-- WHO MAY BE EDITED, AND THE ONE HARD LINE
--   Only a household adult who does NOT hold a login. Somebody with their own
--   account keeps their own details, and this is not a nicety — `people.email`
--   is what a password reset is sent to, so letting one member rewrite
--   another account-holder's email address is an account takeover with extra
--   steps. The refusal says so in those terms.
--
--   Beyond that the authority is `is_household_member_of()` (20260825490000):
--   the adult this login created or linked. A club administrator may always.
--
-- WHAT MAY BE CHANGED
--   The name (a typo in a record you typed is yours to fix), preferred name,
--   email, phone and address. Not the date of birth — that decides whether
--   somebody is a minor and therefore which safeguarding rules apply to them,
--   and it is not something to let a second party rewrite silently. Not
--   `is_player`, which is a person's own statement about themselves.
--
--   Every field is checked the way `update_child_details()` (20260825120000)
--   checks it, and refuses in a sentence rather than by constraint name:
--   the email's shape, and whether it already sits on another live member's
--   record — which would be the same collision `add_household_adult()` uses
--   to LINK records, arriving here as a silent hijack instead.
--
--   Blank keeps what is stored, matching update_own_contact() and
--   update_child_details(). The form pre-fills every field.
--
-- Every change writes one `people.updated_by_household` audit row naming the
-- fields that moved — not their values, because this is contact data.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy added, dropped or
-- altered — a SECURITY DEFINER function that checks its own authority); data
-- touched: none; rollback: drop the function.
-- =============================================================================

create or replace function public.update_household_adult_details(
  p_person_id      uuid,
  p_first_name     text  default null,
  p_last_name      text  default null,
  p_preferred_name text  default null,
  p_email          text  default null,
  p_phone          text  default null,
  p_address        jsonb default null
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $fn$
declare
  v_me     uuid := public.current_person_id();
  v_them   public.people%rowtype;
  v_first  text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last   text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_pref   text := nullif(btrim(coalesce(p_preferred_name, '')), '');
  v_email  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone  text := nullif(btrim(coalesce(p_phone, '')), '');
  v_admin  boolean := public.is_club_admin();
  v_fields text[] := '{}';
begin
  if v_me is null and not v_admin then
    raise exception 'update_household_adult_details: no person is linked to this login' using errcode = '42501';
  end if;

  select * into v_them from public.people p
   where p.id = p_person_id and p.deleted_at is null;
  if not found then
    raise exception 'update_household_adult_details: no such person' using errcode = 'P0001';
  end if;

  if not (v_admin or public.is_household_member_of(p_person_id)) then
    -- `%` is plpgsql's only placeholder in RAISE; `%s` is a `%` wanting an
    -- argument followed by a literal "s", which is a 42601 at creation time.
    raise exception
      'update_household_adult_details: the club''s records do not show % as connected to your account'
      , v_them.first_name using errcode = 'P0001';
  end if;

  -- The hard line. `people.email` is where a password reset goes.
  if not v_admin and exists (select 1 from public.profiles pr where pr.person_id = p_person_id) then
    raise exception
      'update_household_adult_details: % has their own login, so their details are theirs to change — ask them, or ask a club administrator'
      , coalesce(v_them.preferred_name, v_them.first_name) using errcode = 'P0001';
  end if;

  -- A minor is a child, and a child's details are a guardian's to change
  -- through update_child_details(), which asks about guardianship. Nobody
  -- should reach a child through the household-adult door.
  if public.is_minor(p_person_id) then
    raise exception
      'update_household_adult_details: % is under 18 — change a child''s details on Connect Children [SAFEGUARDING.md SG-4]'
      , v_them.first_name using errcode = 'P0001';
  end if;

  if p_address is not null and jsonb_typeof(p_address) <> 'object' then
    raise exception 'update_household_adult_details: the address must be an object' using errcode = 'P0001';
  end if;

  if v_email is not null then
    if length(v_email) not between 6 and 320
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'update_household_adult_details: % does not look like an email address', v_email
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.people pe
       where pe.deleted_at is null
         and pe.id is distinct from p_person_id
         and lower(pe.email) = v_email)
    then
      raise exception 'update_household_adult_details: that email address is already on another member''s record'
        using errcode = 'P0001';
    end if;
  end if;

  if v_first is not null and v_first is distinct from v_them.first_name then
    v_fields := v_fields || 'first_name';
  end if;
  if v_last is not null and v_last is distinct from v_them.last_name then
    v_fields := v_fields || 'last_name';
  end if;
  if v_pref is not null and v_pref is distinct from v_them.preferred_name then
    v_fields := v_fields || 'preferred_name';
  end if;
  if v_email is not null and v_email is distinct from lower(v_them.email) then
    v_fields := v_fields || 'email';
  end if;
  if v_phone is not null and v_phone is distinct from v_them.phone then
    v_fields := v_fields || 'phone';
  end if;
  if p_address is not null and p_address is distinct from v_them.address then
    v_fields := v_fields || 'address';
  end if;

  if array_length(v_fields, 1) is null then
    return;   -- nothing moved; no write, no audit row
  end if;

  update public.people
     set first_name     = coalesce(v_first, first_name),
         last_name      = coalesce(v_last, last_name),
         preferred_name = coalesce(v_pref, preferred_name),
         email          = coalesce(v_email, email),
         phone          = coalesce(v_phone, phone),
         address        = coalesce(p_address, address)
   where id = p_person_id;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'people.updated_by_household', 'people', p_person_id::text,
          jsonb_build_object(
            'fields', to_jsonb(v_fields),
            'by_person_id', v_me,
            'as_admin', v_admin));
end;
$fn$;

comment on function public.update_household_adult_details(uuid, text, text, text, text, jsonb) is
  'Correct the record of a connected adult who has no login of their own. Refuses anyone who holds a login (their email is where a password reset goes), anyone under 18, and an email already on another live member. Names the fields changed in the audit log, never their values.';

revoke all privileges on function public.update_household_adult_details(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.update_household_adult_details(uuid, text, text, text, text, jsonb) to authenticated, service_role;


-- =============================================================================
-- my_household() also returns the preferred name
-- =============================================================================
-- The edit form pre-fills every field it can save, so that "leave it blank to
-- keep it" never comes up — and it could not pre-fill "known as", because
-- my_household() did not return it. Adding a column to the end of a RETURNS
-- TABLE is additive for every caller (PostgREST hands back objects), but the
-- return type changes, so the function has to be dropped and re-made rather
-- than replaced. The body below is the current one, unchanged apart from the
-- new column.
drop function if exists public.my_household();

create or replace function public.my_household()
  returns table (person_id uuid, first_name text, last_name text, preferred_name text,
                 email text, phone text, is_adult boolean, has_login boolean,
                 on_my_membership boolean, my_lead boolean)
  language sql
  stable
  security definer
  set search_path = public
as $mh$
  with me as (select public.current_person_id() as pid),
  in_my_household as (
    select p.id
    from public.people p
    where p.deleted_at is null
      and not public.is_minor(p.id)
      and p.id is distinct from (select pid from me)
      and not exists (select 1 from public.profiles pr where pr.person_id = p.id)
      and (
        p.created_by = auth.uid()
        or exists (select 1 from public.household_links hl
                    where hl.person_id = p.id and hl.owner_user_id = auth.uid())
      )
  ),
  on_mine as (
    select mp.person_id as id
    from public.memberships m
    join public.membership_people mp on mp.membership_id = m.id
    where m.primary_person_id = (select pid from me)
      and mp.person_id <> m.primary_person_id
      and not public.is_minor(mp.person_id)
  ),
  my_leads as (
    select m.primary_person_id as id
    from public.memberships m
    join public.membership_people mp on mp.membership_id = m.id
    where mp.person_id = (select pid from me)
      and m.primary_person_id <> mp.person_id
  )
  select p.id, p.first_name, p.last_name, p.preferred_name, p.email, p.phone,
         not public.is_minor(p.id),
         exists (select 1 from public.profiles pr where pr.person_id = p.id),
         p.id in (select id from on_mine),
         p.id in (select id from my_leads)
  from public.people p
  where p.deleted_at is null
    and p.id in (
      select id from in_my_household
      union
      select id from on_mine
      union
      select id from my_leads
    )
  order by p.first_name, p.last_name;
$mh$;

comment on function public.my_household() is
  'The adults the caller''s account is connected to: their household, whoever is on their membership, and whoever holds a membership they are on. Says of each whether they hold a login and whether they are the lead contact.';

revoke all privileges on function public.my_household() from public, anon;
grant execute on function public.my_household() to authenticated, service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK
--   drop function if exists public.update_household_adult_details(uuid, text, text, text, text, jsonb);
--   drop function public.my_household(); then restore it from 20260825490000
--   (the nine-column version) — dropping is required either way, because the
--   return type differs.
-- =============================================================================
