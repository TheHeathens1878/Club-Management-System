-- =============================================================================
-- For all contacts, first name and last name are separate (Adam, 2026-08-26)
-- =============================================================================
-- "For all contacts, first name and last name are separate."
--
-- `people` has had `first_name` / `last_name` since P1.1. Four other tables
-- were still holding a human being's name as ONE string. This migration splits
-- the ones that are genuinely CONTACT RECORDS — a named person the club writes
-- to, rings, or hands to a coach — and deliberately leaves alone the ones where
-- a `*_name` column is a LABEL, or a denormalised snapshot of who did something.
--
-- -----------------------------------------------------------------------------
-- SPLIT (first_name / last_name become the truth)
-- -----------------------------------------------------------------------------
--   booking_contacts.name             the function room's address book. It
--                                     already had nullable first_name /
--                                     last_name; this finishes the job.
--   waiting_list_entries.player_name  the child on the list.
--   waiting_list_entries.parent_name  the parent or guardian who gets rung.
--   emergency_contacts.name           the person rung in an emergency — the most
--                                     contact-like record in the database.
--   bookings.booker_first_name / booker_last_name — the columns already existed
--                                     (baseline), and the public hire form and
--                                     the booking editor already post both. Only
--                                     the STAFF "new internal booking" form
--                                     posted one box, and older rows never had
--                                     the split filled in. Backfilled here; the
--                                     staff form is split app-side in the same
--                                     change.
--
-- -----------------------------------------------------------------------------
-- DELIBERATELY NOT SPLIT (a label, or a snapshot — not a contact record)
-- -----------------------------------------------------------------------------
--   bookings.booker_name    KEPT as a plain column, NOT made generated. It is
--                           the SNAPSHOT of what the booker typed — the
--                           confirmation emails, the exports, the portal and the
--                           payment reminders all read it — and it legitimately
--                           holds things that are not a person's name at all:
--                           'Club' on a block booking, '(unknown)' and '—' from
--                           the P0.4 lift-and-shift. It is also written
--                           explicitly by the legacy `room_bookings` INSTEAD OF
--                           triggers (20260824100000), which a generated column
--                           would break.
--   bookings.child_name     whose birthday party it is. A detail on a hire, with
--                           no email and no phone: the CONTACT on that booking
--                           is the booker, and they are split above.
--   bookings.team_name      a team label on a booking, not a person.
--   `*_name` actor snapshots — clubhouse_projects.assigned_to_name,
--                           timesheets / sickness_records.staff_name,
--                           holiday_requests.reviewer_name,
--                           booking_emails.sent_by_name, pitch requests'
--                           authorised_by_name, the noticeboard's author_name:
--                           each is a frozen copy of a display name kept beside
--                           a foreign key to the real record, so that history
--                           still reads correctly after a rename. Splitting a
--                           snapshot of the past would be meaningless.
--   resources.name, teams.name, seasons.name, subscriptions.name,
--   fixtures.ft_team_name, lineups.name, push_tokens.device_name — not people.
--
-- -----------------------------------------------------------------------------
-- HOW THE BACKFILL SPLITS, AND WHAT IT REFUSES TO GUESS
-- -----------------------------------------------------------------------------
-- Collapse whitespace, then split on the LAST space: everything before it is the
-- first name (so "Mary Jane Watson" keeps "Mary Jane"), the final token is the
-- last name. A name with NO space cannot be split, so the whole thing stays in
-- `first_name` and `last_name` is left BLANK rather than invented. That is the
-- difference from the existing `split_person_name()` (20260822110000), which
-- fills the missing half with the literal '(unknown)' because a `people` row has
-- to show something in both columns; here a blank is honest, and an
-- administrator can correct it from the screen.
--
-- The display value is preserved everywhere. On `booking_contacts` and
-- `emergency_contacts` the old single-string column becomes a STORED GENERATED
-- column, `btrim(btrim(first_name) || ' ' || btrim(last_name))`: for a name the
-- backfill split that reproduces the original exactly (runs of whitespace
-- collapsed), and for an unsplittable one it reproduces it unchanged.
--
-- `waiting_list_entries` is the exception, and deliberately so: its two display
-- columns stay PLAIN columns MAINTAINED by a trigger. `migrate_neon()`
-- (20260824000000) INSERTs `player_name` / `parent_name` straight from the Neon
-- tables, and a generated column cannot be written — making them generated
-- would break a ~490-line importer that this change has no business rewriting.
-- The trigger takes whichever side the writer supplied and fills in the other,
-- so both parts are populated on every row however it arrived.
--
-- Every existing reader of `.name` / `.player_name` / `.parent_name` therefore
-- keeps working untouched — the contacts book, the waiting-list manage screen,
-- the CSV exports, the confirmation emails.
--
-- NEW rows must supply both parts. On the two generated tables that is a BEFORE
-- INSERT trigger rather than a CHECK constraint, precisely so that backfilled
-- rows whose single-string name could not be split remain legal: the rule is
-- "stop making half-names", not "delete the history". On the waiting list it is
-- `submit_waiting_list_entry()`, the only door the public form and the join
-- wizard have, which refuses a blank half of either name.
--
-- -----------------------------------------------------------------------------
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy is added, dropped or
-- rewritten, and no policy reads a column this migration touches);
-- DATA TOUCHED: YES — this migration UPDATEs every existing row of
-- booking_contacts, waiting_list_entries, emergency_contacts and bookings to
-- fill the split columns, and drops/re-adds four display columns as generated
-- ones. Nothing is deleted and no display value changes beyond collapsing runs
-- of whitespace. The row counts are written to audit_log as
-- 'contacts.name_split.backfill'.
--
-- ROLLBACK.
--   waiting_list_entries: drop trigger trg_waiting_list_name_parts, drop
--     function public.waiting_list_name_parts(), drop the two not-blank
--     constraints, drop the four part columns. The display columns were never
--     altered, so nothing there needs restoring.
--   booking_contacts and emergency_contacts, in this order:
--   drop trigger trg_<table>_name_parts on public.<table>;
--   alter table public.<table> drop column <display>;
--   alter table public.<table> add column <display> text;
--   update public.<table> set <display> = btrim(<first> || ' ' || <last>);
--   alter table public.<table> alter column <display> set not null;   -- where it was
--   alter table public.<table> drop column <first>, drop column <last>;
--     — except booking_contacts, whose first_name/last_name pre-date this
--       migration (make them nullable again instead), and bookings, whose
--       booker_first_name/booker_last_name are baseline columns: only the
--       backfilled VALUES would need clearing, and they are recoverable from
--       booker_name at any time.
--   drop function public.submit_waiting_list_entry(text, text, date, text, text,
--     text, text, text, text, text, text, text, text, boolean, text, boolean);
--     then re-create the 20260824000000 fourteen-argument version.
--   re-create 20260825150000's set_emergency_contacts(uuid, jsonb).
--   drop function public.require_name_parts(), public.contact_name_parts(jsonb),
--     public.contact_name_first(text), public.contact_name_last(text).
-- =============================================================================


-- =============================================================================
-- 1. Splitting on the last space
-- =============================================================================
-- Two scalar functions rather than one set-returning one, so that they can be
-- used in an UPDATE ... SET (a set-returning function cannot be) and, in
-- principle, in an index or a generated column.
create or replace function public.contact_name_first(p_name text)
  returns text
  language plpgsql
  immutable
  set search_path to 'public'
as $$
declare
  v_clean text;
  v_last  integer;
begin
  v_clean := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if position(' ' in v_clean) = 0 then
    -- Not splittable: the whole thing is the first name.
    return v_clean;
  end if;
  v_last := length(v_clean) - position(' ' in reverse(v_clean)) + 1;
  return btrim(left(v_clean, v_last - 1));
end $$;

create or replace function public.contact_name_last(p_name text)
  returns text
  language plpgsql
  immutable
  set search_path to 'public'
as $$
declare
  v_clean text;
  v_last  integer;
begin
  v_clean := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if position(' ' in v_clean) = 0 then
    -- No last name is knowable. Blank, never a guess and never '(unknown)'.
    return '';
  end if;
  v_last := length(v_clean) - position(' ' in reverse(v_clean)) + 1;
  return btrim(substr(v_clean, v_last + 1));
end $$;

comment on function public.contact_name_first(text) is
  'The first-name half of a one-string contact name: everything before the LAST space, or the whole string when there is no space. Mirrored by splitContactName() in apps/web/src/lib/person-name.ts.';
comment on function public.contact_name_last(text) is
  'The last-name half of a one-string contact name: the final token, or BLANK when the name has no space — unlike split_person_name(), which substitutes ''(unknown)''.';

revoke all privileges on function public.contact_name_first(text) from public, anon;
revoke all privileges on function public.contact_name_last(text) from public, anon;
grant execute on function public.contact_name_first(text) to authenticated, service_role;
grant execute on function public.contact_name_last(text) to authenticated, service_role;


-- =============================================================================
-- 2. The "both parts on new rows" trigger
-- =============================================================================
-- Generic over the four tables: the two column names arrive as trigger
-- arguments, and NEW is read through to_jsonb() so one function serves them all.
-- INSERT only — see the header.
create or replace function public.require_name_parts()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  v_row   jsonb := to_jsonb(new);
  v_first text  := btrim(coalesce(v_row ->> tg_argv[0], ''));
  v_last  text  := btrim(coalesce(v_row ->> tg_argv[1], ''));
begin
  if v_first = '' or v_last = '' then
    raise exception '%: a contact needs a first name and a last name, separately', tg_table_name
      using errcode = 'P0001', hint = 'name_parts';
  end if;
  return new;
end $$;

comment on function public.require_name_parts() is
  'BEFORE INSERT guard for the contact tables split on 2026-08-26: a new row must carry both name parts. Takes the two column names as trigger arguments. Deliberately not a CHECK constraint, so that legacy rows whose single-string name could not be split stay legal.';


-- =============================================================================
-- 3. booking_contacts — the function room's address book
-- =============================================================================
update public.booking_contacts
   set first_name = public.contact_name_first(name),
       last_name  = public.contact_name_last(name);

alter table public.booking_contacts
  alter column first_name set not null,
  alter column last_name  set default '',
  alter column last_name  set not null;

alter table public.booking_contacts
  add constraint booking_contacts_first_name_not_blank check (btrim(first_name) <> '');

-- The display column: dropped and re-added as generated, because a plain column
-- cannot be converted in place. Its not-blank CHECK goes with it, replaced by
-- the one on first_name above.
alter table public.booking_contacts drop column name;
alter table public.booking_contacts
  add column name text generated always as (btrim(btrim(first_name) || ' ' || btrim(last_name))) stored;

comment on column public.booking_contacts.name is
  'Display only, generated from first_name and last_name. Kept so that every existing reader (the contacts book, the booking picker, the exports) is unchanged; writers set the two parts.';

create trigger trg_booking_contacts_name_parts
  before insert on public.booking_contacts
  for each row execute function public.require_name_parts('first_name', 'last_name');


-- =============================================================================
-- 4. waiting_list_entries — the player, and the parent who gets rung
-- =============================================================================
alter table public.waiting_list_entries
  add column player_first_name text not null default '',
  add column player_last_name  text not null default '',
  add column parent_first_name text not null default '',
  add column parent_last_name  text not null default '';

update public.waiting_list_entries
   set player_first_name = public.contact_name_first(player_name),
       player_last_name  = public.contact_name_last(player_name),
       parent_first_name = public.contact_name_first(parent_name),
       parent_last_name  = public.contact_name_last(parent_name);

-- The two display columns stay PLAIN columns here, MAINTAINED by a trigger
-- rather than generated. The reason is `migrate_neon()` (20260824000000): the
-- Neon importer INSERTs `player_name` / `parent_name` from the legacy tables,
-- and a generated column cannot be written, so making them generated would
-- break the import — a ~490-line function this change has no business
-- rewriting. The trigger reads whichever side the writer supplied and fills in
-- the other, so the two parts are populated on every row however it arrived,
-- and the display value is still exactly first + last.
alter table public.waiting_list_entries
  add constraint waiting_list_entries_player_first_not_blank check (btrim(player_first_name) <> ''),
  add constraint waiting_list_entries_parent_first_not_blank check (btrim(parent_first_name) <> '');

comment on column public.waiting_list_entries.player_name is
  'Display only, maintained by trg_waiting_list_name_parts from player_first_name and player_last_name. New writers set the two parts; the legacy Neon importer sets this and the parts are derived from it.';
comment on column public.waiting_list_entries.parent_name is
  'Display only, maintained by trg_waiting_list_name_parts from parent_first_name and parent_last_name.';

create or replace function public.waiting_list_name_parts()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  v_split_player boolean := btrim(coalesce(new.player_first_name, '')) = '';
  v_split_parent boolean := btrim(coalesce(new.parent_first_name, '')) = '';
begin
  -- The parts win, EXCEPT when an UPDATE edited only the display name (an
  -- administrator correcting a legacy row through a one-box screen), which is
  -- re-split instead. OLD is only touched inside the UPDATE branch: SQL's AND
  -- is not short-circuiting, so it cannot be tested in one expression.
  if tg_op = 'UPDATE' then
    if new.player_name is distinct from old.player_name
       and new.player_first_name is not distinct from old.player_first_name
       and new.player_last_name is not distinct from old.player_last_name then
      v_split_player := true;
    end if;
    if new.parent_name is distinct from old.parent_name
       and new.parent_first_name is not distinct from old.parent_first_name
       and new.parent_last_name is not distinct from old.parent_last_name then
      v_split_parent := true;
    end if;
  end if;

  if v_split_player then
    new.player_first_name := public.contact_name_first(new.player_name);
    new.player_last_name  := public.contact_name_last(new.player_name);
  else
    new.player_first_name := btrim(new.player_first_name);
    new.player_last_name  := btrim(coalesce(new.player_last_name, ''));
  end if;
  new.player_name := btrim(new.player_first_name || ' ' || new.player_last_name);

  if v_split_parent then
    new.parent_first_name := public.contact_name_first(new.parent_name);
    new.parent_last_name  := public.contact_name_last(new.parent_name);
  else
    new.parent_first_name := btrim(new.parent_first_name);
    new.parent_last_name  := btrim(coalesce(new.parent_last_name, ''));
  end if;
  new.parent_name := btrim(new.parent_first_name || ' ' || new.parent_last_name);

  return new;
end $$;

comment on function public.waiting_list_name_parts() is
  'Keeps waiting_list_entries'' two name pairs and their display columns in step, in whichever direction the writer used: the public form and the join wizard post the parts, the legacy Neon importer posts the one-string name and the parts are split out of it.';

create trigger trg_waiting_list_name_parts
  before insert or update on public.waiting_list_entries
  for each row execute function public.waiting_list_name_parts();

-- The only writer. Fourteen arguments become sixteen: the two name arguments are
-- replaced by four. The old signature is DROPPED rather than left beside the new
-- one — an overload set that differs only in the middle is a trap.
drop function if exists public.submit_waiting_list_entry(text, date, text, text, text, text, text, text, text, text, text, boolean, text, boolean);

create function public.submit_waiting_list_entry(
  p_player_first_name text, p_player_last_name text, p_dob date, p_age_group text, p_school_year text,
  p_biological_sex text, p_team_preference text, p_school text, p_health_conditions text,
  p_parent_first_name text, p_parent_last_name text, p_parent_email text, p_parent_phone text,
  p_coaching_interest boolean, p_coaching_note text, p_data_consent boolean
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not coalesce(p_data_consent, false) then
    raise exception 'waiting list: data consent is required' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_player_first_name, '')), '') is null
     or nullif(btrim(coalesce(p_player_last_name, '')), '') is null then
    raise exception 'waiting list: the player''s first name and last name are both required' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_parent_first_name, '')), '') is null
     or nullif(btrim(coalesce(p_parent_last_name, '')), '') is null then
    raise exception 'waiting list: the parent or guardian''s first name and last name are both required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.waiting_list_age_groups g where g.age_group = p_age_group and g.is_open) then
    raise exception 'waiting list: age group % is not open' , p_age_group using errcode = 'P0001';
  end if;
  insert into public.waiting_list_entries (
    source, player_first_name, player_last_name, dob, age_group, school_year, biological_sex,
    team_preference, school, health_conditions,
    parent_first_name, parent_last_name, parent_email, parent_phone,
    coaching_interest, coaching_note, data_consent
  ) values (
    'form', btrim(p_player_first_name), btrim(p_player_last_name), p_dob, p_age_group,
    nullif(btrim(p_school_year), ''), coalesce(p_biological_sex, 'MALE'),
    nullif(btrim(p_team_preference), ''), nullif(btrim(p_school), ''), nullif(btrim(p_health_conditions), ''),
    btrim(p_parent_first_name), btrim(p_parent_last_name), lower(btrim(p_parent_email)), btrim(p_parent_phone),
    coalesce(p_coaching_interest, false), nullif(btrim(p_coaching_note), ''), true
  );
end $$;

revoke all privileges on function public.submit_waiting_list_entry(text, text, date, text, text, text, text, text, text, text, text, text, text, boolean, text, boolean) from public;
grant execute on function public.submit_waiting_list_entry(text, text, date, text, text, text, text, text, text, text, text, text, text, boolean, text, boolean) to anon, authenticated;


-- =============================================================================
-- 5. emergency_contacts — the person who gets rung
-- =============================================================================
alter table public.emergency_contacts
  add column first_name text not null default '',
  add column last_name  text not null default '';

update public.emergency_contacts
   set first_name = public.contact_name_first(name),
       last_name  = public.contact_name_last(name);

alter table public.emergency_contacts drop column name;   -- takes its CHECK with it
alter table public.emergency_contacts
  add column name text generated always as (btrim(btrim(first_name) || ' ' || btrim(last_name))) stored;

alter table public.emergency_contacts
  add constraint emergency_contacts_first_name_not_blank check (btrim(first_name) <> '');

comment on column public.emergency_contacts.name is
  'Display only, generated from first_name and last_name. A third party who never joined this club: never copied into audit_log, never shown to anyone outside the table''s read policies.';

create trigger trg_emergency_contacts_name_parts
  before insert on public.emergency_contacts
  for each row execute function public.require_name_parts('first_name', 'last_name');

-- Reading a posted contact's two name parts. A legacy object carrying only
-- `name` is still split rather than rejected outright, so that anything still
-- posting the old shape degrades to the same rule instead of failing oddly; a
-- single-token legacy name has no last name and IS then refused, which is the
-- new rule doing its job.
create or replace function public.contact_name_parts(p_item jsonb)
  returns table (first_name text, last_name text)
  language plpgsql
  immutable
  set search_path = public
as $$
declare
  v_first text := nullif(btrim(coalesce(p_item ->> 'first_name', '')), '');
  v_last  text := nullif(btrim(coalesce(p_item ->> 'last_name', '')), '');
  v_name  text;
begin
  if v_first is null and v_last is null then
    v_name := nullif(btrim(coalesce(p_item ->> 'name', '')), '');
    if v_name is not null then
      v_first := nullif(public.contact_name_first(v_name), '');
      v_last  := nullif(public.contact_name_last(v_name), '');
    end if;
  end if;
  first_name := v_first;
  last_name  := v_last;
  return next;
end $$;

comment on function public.contact_name_parts(jsonb) is
  'The {first_name, last_name} of a posted contact object, falling back to splitting a legacy {name}. Either half comes back NULL when it is missing or blank, which is what the callers refuse on.';

revoke all privileges on function public.contact_name_parts(jsonb) from public, anon;
grant execute on function public.contact_name_parts(jsonb) to authenticated, service_role;

create or replace function public.set_emergency_contacts(
  p_person_id uuid,
  p_contacts  jsonb
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me           uuid := public.current_person_id();
  v_admin        boolean := public.is_club_admin();
  v_count        integer;
  v_item         jsonb;
  v_pos          smallint := 0;
  v_first        text;
  v_last         text;
  v_phone        text;
  v_relationship text;
begin
  if p_person_id is null then
    raise exception 'set_emergency_contacts: person is required' using errcode = '22023';
  end if;

  -- An unlinked login: signed in, but not yet joined to a person. It cannot be
  -- acting for itself because there is no "itself" yet. An administrator is
  -- exempt — an admin acts for the club, not for a person.
  if v_me is null and not v_admin then
    raise exception 'set_emergency_contacts: no person is linked to this login'
      using errcode = '42501';
  end if;

  if not (public.can_act_for(p_person_id) or v_admin) then
    raise exception 'set_emergency_contacts: you may only set emergency contacts for yourself or a child you are the guardian of'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.people p
     where p.id = p_person_id and p.deleted_at is null)
  then
    raise exception 'set_emergency_contacts: no such person' using errcode = 'P0001';
  end if;

  if p_contacts is null or jsonb_typeof(p_contacts) <> 'array' then
    raise exception 'set_emergency_contacts: give a list of emergency contacts'
      using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_contacts);
  if v_count > 2 then
    raise exception 'set_emergency_contacts: at most two emergency contacts can be recorded'
      using errcode = 'P0001';
  end if;

  -- Validate the whole list BEFORE deleting anything. A half-applied replace
  -- would leave a person with fewer contacts than they started with because the
  -- second one had a typo in it.
  for v_item in select * from jsonb_array_elements(p_contacts) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'set_emergency_contacts: each emergency contact must be a first name, a last name, a phone number and an optional relationship'
        using errcode = 'P0001';
    end if;
    select n.first_name, n.last_name into v_first, v_last
      from public.contact_name_parts(v_item) n;
    if v_first is null or v_last is null
       or nullif(btrim(coalesce(v_item ->> 'phone', '')), '') is null then
      raise exception 'set_emergency_contacts: a contact needs a first name, a last name and a phone number'
        using errcode = 'P0001';
    end if;
  end loop;

  delete from public.emergency_contacts where person_id = p_person_id;

  for v_item in select * from jsonb_array_elements(p_contacts) loop
    v_pos := v_pos + 1;
    select n.first_name, n.last_name into v_first, v_last
      from public.contact_name_parts(v_item) n;
    v_phone        := btrim(v_item ->> 'phone');
    v_relationship := nullif(btrim(coalesce(v_item ->> 'relationship', '')), '');

    insert into public.emergency_contacts
      (person_id, "position", first_name, last_name, phone, relationship, updated_by)
    values
      (p_person_id, v_pos, v_first, v_last, v_phone, v_relationship, auth.uid());
  end loop;

  -- The count and the actor, never the names and never the numbers.
  perform public.write_audit(
    'people.emergency_contacts.updated', 'people', p_person_id::text,
    jsonb_build_object('count', v_count, 'by_person_id', v_me));
end;
$$;

comment on function public.set_emergency_contacts(uuid, jsonb) is
  'Replace a person''s emergency contacts with the given list of at most two {first_name, last_name, phone, relationship} objects, numbered 1..n; a legacy {name, ...} object is split on the last space. The subject, an active guardian of a minor subject, or a club administrator. Audits the count and the actor, never the contacts themselves.';

revoke all privileges on function public.set_emergency_contacts(uuid, jsonb) from public, anon;
grant execute on function public.set_emergency_contacts(uuid, jsonb) to authenticated, service_role;


-- =============================================================================
-- 6. bookings — fill the split columns that were already there
-- =============================================================================
-- booker_name STAYS a plain column (see the header). These two are filled so
-- that every booking can answer "first name?" without re-splitting, which is
-- what the confirmation emails and the contacts book want. Only rows that have
-- no first name yet are touched: where the hire form or the editor already
-- captured two boxes, what the customer typed wins over any split of ours.
update public.bookings
   set booker_first_name = public.contact_name_first(booker_name),
       booker_last_name  = nullif(public.contact_name_last(booker_name), '')
 where booker_first_name is null or btrim(booker_first_name) = '';

comment on column public.bookings.booker_first_name is
  'The booker''s first name. Filled on every row from 2026-08-26. booker_name remains the snapshot of what was typed, and may be a label such as ''Club'' on a block booking rather than a person''s name.';


-- =============================================================================
-- 7. What the backfill touched
-- =============================================================================
do $$
declare
  v_contacts bigint;
  v_waiting  bigint;
  v_emerg    bigint;
  v_bookings bigint;
begin
  select count(*) into v_contacts from public.booking_contacts;
  select count(*) into v_waiting  from public.waiting_list_entries;
  select count(*) into v_emerg    from public.emergency_contacts;
  select count(*) into v_bookings from public.bookings where booker_first_name is not null;
  perform public.write_audit(
    'contacts.name_split.backfill', 'booking_contacts', null::text,
    jsonb_build_object('booking_contacts', v_contacts, 'waiting_list_entries', v_waiting,
                       'emergency_contacts', v_emerg, 'bookings_with_first_name', v_bookings));
end $$;

notify pgrst, 'reload schema';
