-- =============================================================================
-- A parent corrects their child's details — but never the name or the DOB
-- =============================================================================
-- Adam, 2026-08-25: "the ability to edit children's details (not name or DOB)
-- as a parent. There should be a box to tick 'Same address as lead contact' or
-- free type address (for divorced / separated parents)."
--
-- `people` has a guardian READ policy and deliberately no guardian WRITE
-- policy (P1.2 / SG-4), and that stays exactly as it is: this migration adds
-- ONE narrow SECURITY DEFINER door instead of widening the table.
--
-- WHAT THE DOOR ADMITS
--   Contact only — email, phone, address, preferred name. Name and date of
--   birth are not parameters at all, which is the strongest form of "not
--   editable here": there is no argument to pass and nothing to guard. SG-0
--   makes the date of birth administrative — every safeguarding rule in the
--   platform is derived from it, so it is the club's record to correct, not a
--   field on a parent's form.
--
-- WHO MAY OPEN IT
--   An ACTIVE guardian of a MINOR child, exactly as SG-4 states it: authority
--   comes from the live `guardianships` link, never from holding the `parent`
--   role, and it lapses when the child turns 18 — from that day the young
--   adult keeps their own contact details. An ended arrangement is an ended
--   arrangement.
--
-- THE TICK-BOX
--   "Same address as lead contact" is the WEB's affordance, not a column: the
--   page reads the signed-in guardian's own `people.address` and posts it as
--   this child's address. Two households therefore diverge naturally — the
--   separated parent unticks it and types their own — and neither address
--   points at the other's record, so correcting one never rewrites the other.
--
-- THE EMAIL IS NOT A BACK DOOR
--   Putting an email address on a child's record does not get that child an
--   account. `handle_new_user()`'s adopt-an-invited-person branch matches on
--   email only for a person who is NOT a minor; a minor is adopted solely
--   through an active `app_account` consent (SG-10), which is granted on this
--   same page and audited. So this function widens contact data, never access.
--
-- THE AUDIT ROW
--   `people.child.updated` names the FIELDS that changed and never their
--   values: the trail must show that a guardian corrected a child's phone
--   number without reprinting a child's phone number in a table more people
--   can read than can read `people`.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no table, no policy change —
-- the function gates itself and `people` keeps its read-only guardian policy);
-- data touched: none; rollback: drop the function.
-- =============================================================================

create or replace function public.update_child_details(
  p_child_person_id uuid,
  p_email           text  default null,
  p_phone           text  default null,
  p_address         jsonb default null,
  p_preferred_name  text  default null
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_me     uuid := public.current_person_id();
  v_child  public.people%rowtype;
  v_email  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone  text := nullif(btrim(coalesce(p_phone, '')), '');
  v_pref   text := nullif(btrim(coalesce(p_preferred_name, '')), '');
  v_fields text[] := '{}';
begin
  if v_me is null then
    raise exception 'update_child_details: no person is linked to this login' using errcode = '42501';
  end if;

  select * into v_child
  from public.people p
  where p.id = p_child_person_id and p.deleted_at is null;
  if not found then
    raise exception 'update_child_details: no such person' using errcode = 'P0001';
  end if;

  -- SG-4, in the order it is written: a minor, and a live link to this adult.
  if not public.is_minor(p_child_person_id) then
    raise exception
      'update_child_details: % is 18 or over and keeps their own contact details [SAFEGUARDING.md SG-4]',
      v_child.first_name using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.guardianships g
    where g.child_person_id = p_child_person_id
      and g.guardian_person_id = v_me
      and g.ended_at is null)
  then
    raise exception
      'update_child_details: only an active guardian may change a child''s details [SAFEGUARDING.md SG-4]'
      using errcode = 'P0001';
  end if;

  if p_address is not null and jsonb_typeof(p_address) <> 'object' then
    raise exception 'update_child_details: the address must be an object' using errcode = 'P0001';
  end if;

  -- The shape `people_email_format` enforces, checked here so the parent reads
  -- a sentence rather than a constraint name. Uniqueness is checked for the
  -- same reason: `people_email_unique_live_idx` would otherwise answer 23505.
  if v_email is not null then
    if length(v_email) not between 6 and 320
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'update_child_details: % does not look like an email address', v_email
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.people pe
      where pe.deleted_at is null
        and pe.id is distinct from p_child_person_id
        and lower(pe.email) = v_email)
    then
      raise exception 'update_child_details: that email address is already on another member''s record'
        using errcode = 'P0001';
    end if;
  end if;

  -- Blank keeps what is stored, exactly as update_own_contact() behaves; the
  -- form pre-fills every field, so a parent never meets that rule by surprise.
  if v_email is not null and v_email is distinct from lower(v_child.email) then
    v_fields := v_fields || 'email'::text;
  end if;
  if v_phone is not null and v_phone is distinct from v_child.phone then
    v_fields := v_fields || 'phone'::text;
  end if;
  if p_address is not null and p_address is distinct from v_child.address then
    v_fields := v_fields || 'address'::text;
  end if;
  if v_pref is not null and v_pref is distinct from v_child.preferred_name then
    v_fields := v_fields || 'preferred_name'::text;
  end if;

  update public.people
     set email          = coalesce(v_email, email),
         phone          = coalesce(v_phone, phone),
         address        = coalesce(p_address, address),
         preferred_name = coalesce(v_pref, preferred_name)
   where id = p_child_person_id and deleted_at is null;

  if coalesce(array_length(v_fields, 1), 0) > 0 then
    perform public.write_audit(
      'people.child.updated', 'people', p_child_person_id::text,
      jsonb_build_object('fields', to_jsonb(v_fields), 'guardian_person_id', v_me));
  end if;
end $$;

comment on function public.update_child_details(uuid, text, text, jsonb, text) is
  'An active guardian corrects a minor child''s contact details. Name and date of birth are not parameters: SG-0 makes the date of birth administrative and the club owns the name. Audits the changed field names, never their values.';

revoke all privileges on function public.update_child_details(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.update_child_details(uuid, text, text, jsonb, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK (documented, not executed)
-- =============================================================================
-- drop function public.update_child_details(uuid, text, text, jsonb, text);
-- Audit rows stay.
