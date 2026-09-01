-- =============================================================================
-- Connect an adult player — link an existing record instead of duplicating it
-- (Adam, 2026-08-26)
-- =============================================================================
-- "Change the heading on Connect an adult to Connect an adult player. If they
--  already exist in the system (name and email check) then it links to that
--  record."
--
-- Today `add_household_adult()` (20260824280000) always INSERTs a new `people`
-- row. Add your wife twice, or add somebody the club already holds, and the
-- members database grows a second record for the same human being. That is the
-- /join dedupe gap, and this migration closes it for the household-adult door.
--
-- -----------------------------------------------------------------------------
-- WHAT COUNTS AS A MATCH, AND WHY THE TWO KINDS ARE NOT TREATED ALIKE
-- -----------------------------------------------------------------------------
-- Adam asked for "name and email check". Those are two very different pieces of
-- evidence and this function treats them differently on purpose, because the
-- consequence of a wrong match is not a cosmetic duplicate — it is handing one
-- member the email address, phone number and registration rights of a person
-- they merely guessed the name of.
--
--   EMAIL (case-insensitive, `deleted_at is null`) — STRONG, links silently.
--     `people_email_unique_live_idx` is unique on lower(email) among live rows,
--     so an email match is at most one person: there is no "which one did you
--     mean". Knowing somebody's email address is already the proof this
--     codebase accepts for identity elsewhere — `handle_new_user()` attaches a
--     brand-new login to an existing `people` row when the sign-up email equals
--     the person's email, with no other evidence at all. Accepting the same
--     evidence here is consistent, and it is the case that actually produces
--     duplicates in practice (the club holds Sam from a Full-Time import; Sam's
--     partner adds Sam with Sam's email; today that INSERT fails on the unique
--     index or, with no email typed, silently duplicates).
--
--   FIRST NAME + LAST NAME (case-insensitive, trimmed, both together) — WEAK,
--     never links on its own. A name is public: it is on a team sheet, a fixture
--     report, the noticeboard. If a name match linked, then any member could
--     type "John Smith" and, on the next page load, read John Smith's email
--     address and phone number out of `my_household()` and submit registrations
--     in his name. So a name-only match — and equally a name match whose typed
--     email is different, or absent — does NOT link and does NOT silently
--     create either. It stops, and the screen is told:
--       * "the club already has a record for someone with that name; if that is
--         the person in your household, add their email address so we can match
--         them" (hint `confirm_new`), and
--       * "if this is a different person, add them as a new record" — which the
--         member confirms explicitly with `p_confirm_new => true`.
--     The member therefore has exactly two ways forward, and neither of them
--     discloses anything: supply the email (which is proof), or say plainly that
--     this is somebody else (which creates the second record, deliberately, with
--     an audit row saying it was a confirmed near-duplicate so an administrator
--     can merge them if it turns out otherwise).
--
--     What that refusal does disclose is one bit: "somebody by this name is
--     known to the club". That is accepted, bounded and deliberate. The caller
--     is already a known adult member of this club, the name is the only thing
--     revealed (never an email, a phone number, an age or a team), and the same
--     bit is readable off any match report. Minors are excluded from name
--     matching entirely, so it can never be used to confirm that a NAMED CHILD
--     is at this club.
--
-- -----------------------------------------------------------------------------
-- THE FOUR REFUSALS ON AN EMAIL MATCH (an email match is strong, not a skeleton
-- key)
-- -----------------------------------------------------------------------------
--   1. THEY HOLD A LOGIN. A person with their own `profiles` row is never
--      absorbed into somebody else's household — not silently, not on
--      confirmation, not at all. The screen says "already has their own account"
--      and stops. This is the safeguarding heart of the change: a login-holder
--      is an autonomous member of the club who can speak for themselves, and
--      household membership is a power OVER a person (it lets the holder submit
--      registrations in their name and put them on a family membership). It may
--      only ever be held over somebody who cannot yet act for themselves. The
--      legitimate route for a login-holder is the one 20260824490000 already
--      built: an administrator puts them on the lead contact's membership, and
--      `my_household()` shows them from the membership side.
--   2. THEY ARE A MINOR. `add_child()` exists so that adding a child records a
--      guardianship; linking a child here would create the household tie WITHOUT
--      the guardianship, which is precisely the SG-4 hole `add_household_adult`
--      was written to avoid.
--   3. THEY HOLD A CLUB ROLE beyond a bare `member` — coach, staff, club_admin,
--      safeguarding_lead, referee. Club officers are not household members, and
--      an attacker who has an officer's (frequently published) email address
--      must not be able to attach them.
--   4. THE DATE OF BIRTH ON RECORD DISAGREES. The form already asks for a date
--      of birth, so this second factor is free: an email match whose stored
--      non-null dob differs from the one typed is two different people, or a
--      typo somewhere, and either way an administrator should look. A record
--      with NO dob on file (legacy imports) links on the email alone.
--   Plus: ALREADY SOMEBODY ELSE'S. A record another member already holds in
--   their household is not transferred by typing their email. Records created by
--   an administrator are not "claimed" in that sense and remain linkable — that
--   is the Full-Time-import case this feature exists for.
--
-- -----------------------------------------------------------------------------
-- WHAT "LINKED" MEANS
-- -----------------------------------------------------------------------------
-- `add_household_adult()` never had a link table: the household tie IS
-- `people.created_by = auth.uid()` plus "holds no login" (20260824470000,
-- narrowed by 20260824490000). Re-pointing `created_by` at the caller would
-- reproduce that tie exactly — and destroy the record of who actually created
-- the row, which for an imported or administrator-entered person is the only
-- provenance there is. So linking gets its own table, `household_links`, and
-- the three places that ask "is this person in my household?" are taught to
-- read it:
--
--   * `is_household_member_of()` — the RLS/`registrations_guard` predicate,
--   * `my_household()` — what Connected Adults lists,
--   * `create_membership()` — which people may go on a family membership; its
--     inline copy of the predicate is replaced by a call to the function, so
--     there is one definition of "household" and not two.
--
-- A linked person is therefore treated exactly as a freshly created one, and
-- drops out of the caller's household the moment they gain a login of their own
-- — the same rule created-by-me rows already follow, and the safe direction:
-- getting an account ENDS somebody else's write access over you, and the
-- family-membership tie (20260824490000) carries the relationship on.
--
-- Linking WRITES NOTHING TO `people`. Not the dob, not the phone, not the name.
-- The existing record is somebody else's data; the caller gets a link to it, not
-- an edit of it.
--
-- Audit: `family.adult_linked` when an existing record was attached (with the
-- basis of the match), `family.adult_added` when a new record was created (with
-- whether it was a confirmed near-duplicate). The audit row says which happened.
--
-- -----------------------------------------------------------------------------
-- PR METADATA (PLAN.md §11): migrations y; RLS y (new table `household_links`
-- with policies, written only through the SECURITY DEFINER function); data
-- touched: none in this migration — no backfill, no UPDATE of any existing row;
-- rollback below.
--
-- ROLLBACK:
--   drop function public.add_household_adult(text, text, date, text, text, boolean);
--   -- re-create the 20260824280000 five-argument version;
--   -- re-create 20260824490000's my_household(), 20260824280000's
--   -- is_household_member_of() and create_membership();
--   drop table public.household_links;
-- =============================================================================


-- =============================================================================
-- 1. household_links — an existing person attached to a household
-- =============================================================================
create table public.household_links (
  id             uuid primary key default gen_random_uuid(),

  -- The login whose household this is. `people.created_by` is an auth user, and
  -- the household predicate keys on `auth.uid()`; this column matches that
  -- shape so the two branches unify cleanly.
  owner_user_id  uuid not null references auth.users (id) on delete cascade,

  -- restrict, not cascade: `people` is soft-deleted (SG-2), never removed.
  person_id      uuid not null references public.people (id) on delete restrict,

  -- What evidence justified the link. Only 'email' exists today; a name match
  -- never produces a row here, and the column is the audit trail for that.
  match_basis    text not null,

  linked_at      timestamptz not null default now(),
  linked_by      uuid references auth.users (id) on delete set null,

  constraint household_links_unique unique (owner_user_id, person_id),
  constraint household_links_basis check (match_basis in ('email'))
);

comment on table public.household_links is
  'An EXISTING person attached to a household by add_household_adult() after an email match, rather than a second people row being created. The other household tie (people.created_by, no login) is unchanged; this table is the second branch of the same definition. Written only through add_household_adult(); no INSERT/UPDATE/DELETE grant exists for authenticated.';
comment on column public.household_links.match_basis is
  'The evidence that justified the link. Only ''email'' today: a name-only match never links (see the migration header).';

create index household_links_person_idx on public.household_links (person_id);

-- ---------------------------------------------------------------------------
-- RLS. Reading: the owner sees their own links, club_admin and
-- safeguarding_lead see all (they answer "why is Sam on this household?").
-- Writing: nobody, through the API. The only writer is add_household_adult(),
-- SECURITY DEFINER, which performs every check in the header first. There is
-- deliberately no unlink path in this migration — removing a link is an
-- administrator's job and gets its own task.
-- ---------------------------------------------------------------------------
alter table public.household_links enable row level security;

create policy "household_links_owner_read" on public.household_links
  for select to authenticated
  using (owner_user_id = auth.uid()
         or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));

revoke all privileges on public.household_links from anon, authenticated, service_role;
grant select on public.household_links to authenticated;
grant select, insert, update, delete on public.household_links to service_role;


-- =============================================================================
-- 2. is_household_member_of() — created by me, OR linked to me
-- =============================================================================
-- Same two extra conditions on both branches: the person is live, and holds no
-- login of their own. A person who gains a login stops being anybody's
-- household member and speaks for themselves.
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
      and p.deleted_at is null
      and not exists (select 1 from public.profiles pr where pr.person_id = p.id)
      and (
        p.created_by = auth.uid()
        or exists (select 1 from public.household_links hl
                    where hl.person_id = p.id and hl.owner_user_id = auth.uid())
      ));
$$;
revoke all privileges on function public.is_household_member_of(uuid) from public, anon;
grant execute on function public.is_household_member_of(uuid) to authenticated, service_role;


-- =============================================================================
-- 3. my_household() — the linked adults appear beside the created ones
-- =============================================================================
-- 20260824490000's three shapes, plus a fourth that is really the first one
-- widened: an adult with no login who is in my household because I linked them.
drop function if exists public.my_household();

create function public.my_household()
  returns table (
    person_id uuid, first_name text, last_name text,
    email text, phone text, is_adult boolean,
    has_login boolean, on_my_membership boolean, my_lead boolean
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
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
  select p.id, p.first_name, p.last_name, p.email, p.phone,
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
$$;

revoke all privileges on function public.my_household() from public, anon;
grant execute on function public.my_household() to authenticated, service_role;


-- =============================================================================
-- 4. add_household_adult() — match, then link or create
-- =============================================================================
-- The signature gains `p_confirm_new`, so the five-argument version is dropped
-- first: leaving both would make a five-argument call ambiguous.
drop function if exists public.add_household_adult(text, text, date, text, text);

create function public.add_household_adult(
  p_first_name text, p_last_name text, p_dob date,
  p_email text default null, p_phone text default null,
  p_confirm_new boolean default false
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me        uuid := public.current_person_id();
  v_my_dob    date;
  v_first     text := btrim(coalesce(p_first_name, ''));
  v_last      text := btrim(coalesce(p_last_name, ''));
  v_email     text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_cand      public.people%rowtype;
  v_new       uuid;
  v_claimed   boolean;
  v_named     integer;
begin
  if v_me is null then
    raise exception 'add_household_adult: no person is linked to this login' using errcode = '42501';
  end if;
  select dob into v_my_dob from public.people where id = v_me;
  if v_my_dob is null or public.is_minor_dob(v_my_dob) then
    raise exception 'add_household_adult: only a known adult can add household members [SAFEGUARDING.md SG-4]'
      using errcode = 'P0001';
  end if;
  if v_first = '' or v_last = '' then
    raise exception 'add_household_adult: a first name and a last name are both required' using errcode = 'P0001';
  end if;
  if p_dob is null or p_dob > current_date then
    raise exception 'add_household_adult: a valid date of birth is required' using errcode = 'P0001';
  end if;
  if public.is_minor_dob(p_dob) then
    raise exception 'add_household_adult: % is a minor — add children with add_child() so a guardianship is recorded [SAFEGUARDING.md SG-4]',
      v_first using errcode = 'P0001';
  end if;

  -- -------------------------------------------------------------------------
  -- (a) EMAIL MATCH. At most one row: the live-email unique index says so.
  -- -------------------------------------------------------------------------
  if v_email is not null then
    select * into v_cand
      from public.people p
     where p.deleted_at is null and lower(p.email) = v_email
     limit 1;

    if found then
      if v_cand.id = v_me then
        raise exception 'add_household_adult: that is your own email address — you are already on your household'
          using errcode = 'P0001';
      end if;

      -- 1. A login of their own. Never absorbed, on any evidence.
      if exists (select 1 from public.profiles pr where pr.person_id = v_cand.id) then
        raise exception '% already has their own account with that email address. They sign in and register themselves; ask a club administrator to put them on your family membership. [SAFEGUARDING.md SG-4]',
          v_cand.first_name
          using errcode = 'P0001', hint = 'has_login';
      end if;

      -- 2. A child. add_child() records the guardianship; this door does not.
      if public.is_minor(v_cand.id) then
        raise exception 'add_household_adult: the club already holds a child with that email address — add children with add_child() so a guardianship is recorded [SAFEGUARDING.md SG-4]'
          using errcode = 'P0001';
      end if;

      -- 3. A club officer. Not a household member, and their address is public.
      if exists (select 1 from public.person_roles r
                  where r.person_id = v_cand.id and r.revoked_at is null
                    and r.role <> 'member'::public.app_role) then
        raise exception 'add_household_adult: that email address belongs to somebody who holds a role at the club. Ask a club administrator to connect them.'
          using errcode = 'P0001', hint = 'has_role';
      end if;

      -- 4. A date of birth on file that disagrees with the one typed.
      if v_cand.dob is not null and v_cand.dob <> p_dob then
        raise exception 'add_household_adult: the club already holds a record for that email address, but with a different date of birth. Ask a club administrator to connect them.'
          using errcode = 'P0001', hint = 'dob_mismatch';
      end if;

      -- Already somebody else's household? A record an ADMINISTRATOR created is
      -- not a claim (that is the imported-member case this exists for); a record
      -- another member created or linked is.
      v_claimed := exists (
        select 1 from public.household_links hl
         where hl.person_id = v_cand.id and hl.owner_user_id <> auth.uid()
      ) or (
        v_cand.created_by is not null
        and v_cand.created_by <> auth.uid()
        and not exists (
          select 1 from public.profiles pr
            join public.person_roles r on r.person_id = pr.person_id
           where pr.id = v_cand.created_by
             and r.revoked_at is null
             and r.role in ('club_admin'::public.app_role, 'safeguarding_lead'::public.app_role))
      );
      if v_claimed then
        raise exception 'add_household_adult: that record is already connected to another member''s account. Ask a club administrator.'
          using errcode = 'P0001', hint = 'claimed';
      end if;

      -- LINK. Nothing on the people row is touched.
      insert into public.household_links (owner_user_id, person_id, match_basis, linked_by)
      values (auth.uid(), v_cand.id, 'email', auth.uid())
      on conflict (owner_user_id, person_id) do nothing;

      insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
      values (auth.uid(), (select email from auth.users where id = auth.uid()),
              'family.adult_linked', 'people', v_cand.id::text,
              jsonb_build_object('added_by_person_id', v_me, 'matched_on', 'email', 'created_new', false));
      return v_cand.id;
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- (b) NAME MATCH. Never links. Two exceptions that are not links at all:
  --     the person is ALREADY in this caller's household (adding the same
  --     spouse twice is the commonest duplicate of the lot, and returning the
  --     row they already hold discloses nothing new), or the member has
  --     explicitly said this is somebody else.
  -- -------------------------------------------------------------------------
  select p.id into v_new
    from public.people p
   where p.deleted_at is null
     and p.id <> v_me
     and lower(btrim(p.first_name)) = lower(v_first)
     and lower(btrim(p.last_name)) = lower(v_last)
     and public.is_household_member_of(p.id)
     -- Only when nothing CONTRADICTS it. Two people of the same name, one of
     -- them already mine, must not silently collapse into one.
     and (v_email is null or p.email is null or lower(p.email) = v_email)
     and (p.dob is null or p.dob = p_dob)
   order by p.created_at
   limit 1;
  if v_new is not null then
    insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
    values (auth.uid(), (select email from auth.users where id = auth.uid()),
            'family.adult_linked', 'people', v_new::text,
            jsonb_build_object('added_by_person_id', v_me, 'matched_on', 'already_in_household', 'created_new', false));
    return v_new;
  end if;

  -- Minors are excluded: this branch must never confirm that a named CHILD is
  -- known to the club.
  select count(*) into v_named
    from public.people p
   where p.deleted_at is null
     and p.id <> v_me
     and lower(btrim(p.first_name)) = lower(v_first)
     and lower(btrim(p.last_name)) = lower(v_last)
     and not public.is_minor(p.id);

  if v_named > 0 and not coalesce(p_confirm_new, false) then
    raise exception 'The club already has a record for someone called % %. We cannot connect somebody by name alone — if that is the person in your household, add the email address the club holds for them. If this is a different person, choose "Add them as a new record".',
      v_first, v_last
      using errcode = 'P0001', hint = 'confirm_new';
  end if;

  -- -------------------------------------------------------------------------
  -- (c) CREATE, as before.
  -- -------------------------------------------------------------------------
  insert into public.people (first_name, last_name, dob, email, phone, created_by)
  values (v_first, v_last, p_dob, v_email, nullif(btrim(p_phone), ''), auth.uid())
  returning id into v_new;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'family.adult_added', 'people', v_new::text,
          jsonb_build_object('added_by_person_id', v_me, 'created_new', true,
                             'matched_on', case when v_named > 0 then 'name_confirmed_different' else 'none' end));
  return v_new;
end $$;

comment on function public.add_household_adult(text, text, date, text, text, boolean) is
  'Connect an adult player to the caller''s household. An email match links the existing record (unless they hold a login, are a minor, hold a club role, have a different date of birth on file, or are already another member''s household); a name-only match never links and asks the member either for the email address or for explicit confirmation that this is a different person (p_confirm_new). Audited either way.';

revoke all privileges on function public.add_household_adult(text, text, date, text, text, boolean) from public, anon;
grant execute on function public.add_household_adult(text, text, date, text, text, boolean) to authenticated;


-- =============================================================================
-- 5. create_membership() — one definition of "household", not two
-- =============================================================================
-- Unchanged except that the inline "created by me and holds no login" test is
-- replaced by is_household_member_of(), so a LINKED adult can go on the family
-- membership exactly as a created one can.
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

  v_ids := (select array_agg(distinct pid) from unnest(p_person_ids || v_me) as pid);
  if array_length(v_ids, 1) > 6 then
    raise exception 'create_membership: a family membership covers at most six people' using errcode = 'P0001';
  end if;

  foreach v_pid in array v_ids loop
    if v_pid = v_me then continue; end if;
    if exists (select 1 from public.guardianships g
               where g.child_person_id = v_pid and g.guardian_person_id = v_me and g.ended_at is null) then
      continue;
    end if;
    if public.is_household_member_of(v_pid) then continue; end if;
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

notify pgrst, 'reload schema';
