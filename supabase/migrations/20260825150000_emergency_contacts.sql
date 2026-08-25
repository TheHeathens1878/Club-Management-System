-- =============================================================================
-- An emergency contact belongs to the person, not to a form
-- =============================================================================
-- Adam, 2026-08-25: "Emergency Contacts (up to 2) should be set at contact
-- level, not on registration form."
--
-- Until now the emergency contact lived inside `registrations.form ->
-- 'emergency_contact'` (docs/specs/P2.2-registration-flow.md §2) and was a
-- system row in `registration_questions`. That is the wrong home for it twice
-- over. A registration is a moment — one player, one season, one submission —
-- and it freezes: the number a parent typed last August is still the number in
-- last August's form long after they changed phone. But the question a coach
-- asks on a Saturday morning is "who do I ring for THIS person, NOW", and the
-- answer has to be current and has to exist even for somebody who never
-- registered for anything — a volunteer, a referee, an adult player.
--
-- So this migration moves it up a level: two rows against `people`, edited
-- wherever a person's details are edited, and read straight off the person.
--
-- UP TO TWO, AND THE POSITIONS ARE THE POINT
--   `position` is 1 or 2 and unique per person, which is Adam's "up to 2"
--   written as a constraint rather than as a rule in a form component. First
--   contact and second contact are also how anyone ringing round reads the
--   list, so the order is data, not presentation.
--
-- WHO CAN READ ONE
--   Exactly the readership `registrations.form` had: the subject, their active
--   guardians, `club_admin` and `safeguarding_lead`. `can_act_for()` carries
--   the first two and lapses of its own accord when a child turns 18, the same
--   way SG-4 says it should.
--
--   COACHES ARE DELIBERATELY NOT ON THAT LIST, and that is an OPEN DECISION for
--   Adam rather than a settled one. The argument for is obvious — the person
--   standing on the touchline when a player goes down is the coach. The
--   argument against is that a team's staff list is long and changes often, and
--   an emergency contact is a third party's name and phone number who never
--   joined this club and cannot see who holds their details. Widening it later
--   is one policy; narrowing it after the fact is a data-protection incident.
--   Starting narrow costs a phone call to an admin; starting wide cannot be
--   undone. If Adam wants team staff to see them, add a third SELECT policy —
--   nothing else in this file has to change.
--
-- WHY THERE IS NO INSERT, UPDATE OR DELETE POLICY
--   Every write goes through `set_emergency_contacts()`. "Up to two" and
--   "positions 1..n with no gaps" are properties of the SET, and a row-at-a-
--   time policy cannot see a set: a client with an INSERT policy could add a
--   third row, or leave a person with a position 2 and no position 1. The RPC
--   replaces the whole list in one transaction, so those invariants hold by
--   construction. The table is readable and otherwise inert.
--
-- THE AUDIT ROW COUNTS, IT DOES NOT COPY
--   `people.emergency_contacts.updated` records how many contacts were stored
--   and who stored them, never a name and never a number. `audit_log` is read
--   by more people than this table is, and copying the contents into it would
--   quietly hand the wider readership what the narrow policies just refused.
--
-- THE REGISTRATION QUESTION GOES
--   `emergency_contact` is deleted from `registration_questions`: the join
--   wizard now collects it against the person. `registration_questions_guard`
--   is `before insert or update` only (20260825140000, line ~187) — it has no
--   DELETE branch — so this delete is admitted even though the row is a system
--   row. Verified by reading the trigger, not assumed. The 'emergency_contact'
--   member of the qtype CHECK constraint STAYS: registrations already
--   submitted keep an answer, and the wording that answer was given under must
--   keep meaning something.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (new table, two read
-- policies, no write policies); data touched: deletes one seeded
-- registration_questions row (no member data); rollback: drop function, drop
-- table, re-insert the seed row.
-- =============================================================================


-- =============================================================================
-- 1. THE TABLE
-- =============================================================================

create table public.emergency_contacts (
  id           uuid primary key default gen_random_uuid(),
  -- restrict, not cascade: a person is soft-deleted (SG-2), never removed, so a
  -- cascade here would only ever fire for a hard delete that should not happen.
  person_id    uuid not null references public.people (id) on delete restrict,
  "position"   smallint not null,
  name         text not null,
  phone        text not null,
  relationship text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,

  -- Adam's "up to 2", as a constraint rather than a rule in a form component.
  constraint emergency_contacts_position_known
    check ("position" in (1, 2)),
  constraint emergency_contacts_name_not_blank
    check (btrim(name) <> ''),
  constraint emergency_contacts_phone_not_blank
    check (btrim(phone) <> ''),
  constraint emergency_contacts_relationship_not_blank
    check (relationship is null or btrim(relationship) <> ''),
  constraint emergency_contacts_person_position_unique
    unique (person_id, "position")
);

comment on table public.emergency_contacts is
  'Up to two emergency contacts held against a person, not against a registration form. Sensitive: readable by the subject, their active guardians, club_admin and safeguarding_lead only — the same readership registrations.form had. Coaches are deliberately excluded for now; whether team staff should see them is an open decision. Written only through set_emergency_contacts().';
comment on column public.emergency_contacts.person_id is
  'The person these contacts are FOR — the player, volunteer or referee — not the contact themselves. The named contact has no record here and no account.';
comment on column public.emergency_contacts."position" is
  '1 or 2, unique per person: first contact, then second. The order anyone ringing round would read the list in, so it is stored rather than inferred.';
comment on column public.emergency_contacts.name is
  'The contact''s name. A third party who never joined this club: never copied into audit_log, never shown to anyone outside the table''s two read policies.';
comment on column public.emergency_contacts.phone is
  'The number to ring. Free text — an emergency contact may be abroad, and a format check that refuses a real number in an emergency is worse than no check.';
comment on column public.emergency_contacts.relationship is
  'Optional: "Mum", "Grandad", "Neighbour". Blank is stored as NULL, never as an empty string.';

create index emergency_contacts_person_idx
  on public.emergency_contacts (person_id);

create trigger trg_emergency_contacts_updated
  before update on public.emergency_contacts
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 2. RLS — two ways to read, no way to write
-- =============================================================================

alter table public.emergency_contacts enable row level security;

-- The subject, or an active guardian of a MINOR subject. can_act_for() lapses
-- on the child's eighteenth birthday without anyone having to remember to
-- revoke anything (SAFEGUARDING.md SG-4).
create policy "emergency_contacts_self_read" on public.emergency_contacts
  for select to authenticated
  using (public.can_act_for(person_id));

-- The two roles that already read registrations.form.
create policy "emergency_contacts_admin_read" on public.emergency_contacts
  for select to authenticated
  using (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));

-- Deliberately no INSERT, UPDATE or DELETE policy: see the header. Even with
-- the grants below, a direct write from PostgREST has no policy to satisfy and
-- is refused.
revoke all privileges on public.emergency_contacts from anon, authenticated, service_role;
grant select on public.emergency_contacts to authenticated;
grant select on public.emergency_contacts to service_role;
revoke insert, update, delete, truncate on public.emergency_contacts
  from anon, authenticated, service_role;


-- =============================================================================
-- 3. set_emergency_contacts() — the only door
-- =============================================================================
-- Replace semantics, on purpose. The form shows both contacts and posts both
-- back, so "what the parent left on the screen" IS the new list: a contact
-- removed from the form is removed from the record, and there is no separate
-- delete call to forget to make.

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
  v_name         text;
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
      raise exception 'set_emergency_contacts: each emergency contact must be a name, a phone number and an optional relationship'
        using errcode = 'P0001';
    end if;
    if nullif(btrim(coalesce(v_item ->> 'name', '')), '') is null
       or nullif(btrim(coalesce(v_item ->> 'phone', '')), '') is null then
      raise exception 'set_emergency_contacts: a contact needs a name and a phone number'
        using errcode = 'P0001';
    end if;
  end loop;

  delete from public.emergency_contacts where person_id = p_person_id;

  for v_item in select * from jsonb_array_elements(p_contacts) loop
    v_pos          := v_pos + 1;
    v_name         := btrim(v_item ->> 'name');
    v_phone        := btrim(v_item ->> 'phone');
    v_relationship := nullif(btrim(coalesce(v_item ->> 'relationship', '')), '');

    insert into public.emergency_contacts
      (person_id, "position", name, phone, relationship, updated_by)
    values
      (p_person_id, v_pos, v_name, v_phone, v_relationship, auth.uid());
  end loop;

  -- The count and the actor, never the names and never the numbers.
  perform public.write_audit(
    'people.emergency_contacts.updated', 'people', p_person_id::text,
    jsonb_build_object('count', v_count, 'by_person_id', v_me));
end;
$$;

comment on function public.set_emergency_contacts(uuid, jsonb) is
  'Replace a person''s emergency contacts with the given list of at most two {name, phone, relationship} objects, numbered 1..n. The subject, an active guardian of a minor subject, or a club administrator. Audits the count and the actor, never the contacts themselves.';

revoke all privileges on function public.set_emergency_contacts(uuid, jsonb) from public, anon;
grant execute on function public.set_emergency_contacts(uuid, jsonb) to authenticated, service_role;


-- =============================================================================
-- 4. THE REGISTRATION QUESTION GOES
-- =============================================================================
-- `registration_questions_guard` is `before insert or update` only — it has no
-- DELETE branch and there is no deny_hard_delete trigger on this table — so a
-- migration may delete a system row even though the app may not create one.
-- The qtype 'emergency_contact' stays in the CHECK constraint: answers already
-- stored under it keep their meaning.

delete from public.registration_questions where qkey = 'emergency_contact';


notify pgrst, 'reload schema';


-- =============================================================================
-- 5. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop function public.set_emergency_contacts(uuid, jsonb);
-- drop table public.emergency_contacts;
-- insert into public.registration_questions
--   (qkey, label, help_text, qtype, options, required, system, locked, position)
-- values
--   ('emergency_contact', 'Emergency contact',
--    'Someone we can ring on a Saturday morning.',
--    'emergency_contact', '[]'::jsonb, true, true, false, 1);
-- Audit rows stay. Contacts recorded through the RPC are lost with the table:
-- take a copy first if any real ones have been entered.
