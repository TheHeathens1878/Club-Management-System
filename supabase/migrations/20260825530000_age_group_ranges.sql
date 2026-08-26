-- =============================================================================
-- An age group can name a RANGE, or name no youth band at all
-- =============================================================================
-- 20260825500000 shipped the rule Adam asked for -- "limit the teams they can
-- choose to their own age group and the age group above" -- reading a team's
-- age group with `waiting_list_age_number()`, which answers only for a label
-- shaped exactly like "U12". Checked against production afterwards, nine of the
-- club's 73 teams are not shaped like that:
--
--   'U05-U08'  (1)  U05 Wildcats -- the club's only under-eights girls team
--   'Open Age' (6)  the men's and women's open-age sides
--   'Vets'     (2)  Vets O35 Women, Vets O45 Men's XI
--
-- Both halves of the rule were wrong for those nine:
--   * The SCREEN offered a child NONE of them, so a five-year-old girl could
--     not be registered for U05 Wildcats through the form at all -- the only
--     team in the club she is eligible for.
--   * The DATABASE allowed ANYONE into all nine, because "no band" was read as
--     "no band to be outside of". A child could be registered into Open Age
--     Spartans by a request the screen would never make.
--
-- So a team's age group is now read as a RANGE of bands, and a label that
-- plainly names an adult side is recognised as one:
--
--   age_group_band_range('U12')      -> [12,12]   a single band, as before
--   age_group_band_range('U05-U08')  -> [5,8]     a range, either dash
--   age_group_band_range('Open Age') -> null      no youth band named
--   age_group_is_adult('Open Age')   -> true      and it says so positively
--   age_group_is_adult('')           -> false     silence is not a statement
--
-- The refusals stay evidence-based, which is the rule 20260825500000 set:
--   * A child is refused a team that NAMES itself adult, and refused a youth
--     range that does not contain their band or the one above. A team whose age
--     group the club has never recorded is still not something the database can
--     judge, so it is allowed (the screen still declines to offer it).
--   * An adult is refused any team naming a youth range -- unchanged.
--   * An unknown date of birth is refused, now in every case rather than only
--     where the team named a band (SG-0: unknown is a minor). The screen has
--     always offered such a person nothing, so this is the two agreeing.
--
-- PR METADATA (PLAN.md 11): migrations y; RLS n (no policy added, dropped or
-- altered); data touched: none; rollback at the foot of this file.
-- =============================================================================


-- 1. The bands an age group names --------------------------------------------
-- Ranges are written with a hyphen or an en dash depending on who typed them
-- (the one on production is an EN DASH), and the second half may or may not
-- repeat the U. All four spellings mean the same thing.
create or replace function public.age_group_band_range(p_age_group text)
  returns int4range
  language plpgsql
  immutable
  set search_path = public
as $fn$
declare
  v_label text := upper(btrim(coalesce(p_age_group, '')));
  v_parts text[];
  v_lo    integer;
  v_hi    integer;
begin
  if v_label = '' then return null; end if;
  -- Every dash-like character the club might type, and the spaces around it.
  v_label := regexp_replace(v_label, '[' || chr(8211) || chr(8212) || chr(8722) || ']', '-', 'g');
  v_label := regexp_replace(v_label, '\s*-\s*', '-', 'g');

  v_parts := regexp_match(v_label, '^U0*([0-9]{1,2})$');
  if v_parts is not null then
    return int4range(v_parts[1]::integer, v_parts[1]::integer, '[]');
  end if;

  v_parts := regexp_match(v_label, '^U0*([0-9]{1,2})-U?0*([0-9]{1,2})$');
  if v_parts is not null then
    v_lo := least(v_parts[1]::integer, v_parts[2]::integer);
    v_hi := greatest(v_parts[1]::integer, v_parts[2]::integer);
    return int4range(v_lo, v_hi, '[]');
  end if;

  return null;
end;
$fn$;

comment on function public.age_group_band_range(text) is
  'The FA bands a team age group names, inclusive: U12 gives [12,12], a U05-U08 range (hyphen or en dash) gives [5,8], anything else null. Adult labels name no youth band.';


-- 2. An age group that says it is an adult side -------------------------------
-- Positively recognised, not inferred from the absence of a U-band: a blank or
-- unrecognised label is NOT an adult team, it is a team the club has not
-- described, and the two must not be confused.
create or replace function public.age_group_is_adult(p_age_group text)
  returns boolean
  language sql
  immutable
  set search_path = public
as $fn$
  select case
    when btrim(coalesce(p_age_group, '')) = '' then false
    -- OPEN AGE, OPEN, SENIORS, ADULT, VETS, VETERANS, and O35/O45-style
    -- over-age labels. Word-boundary anchored so "U11 Openers" is not caught.
    else upper(btrim(p_age_group)) ~
         '(^|[^A-Z])(OPEN|SENIOR|SENIORS|ADULT|ADULTS|VET|VETS|VETERAN|VETERANS|O[0-9]{2}|OVER[ -]?[0-9]{2})([^A-Z]|$)'
  end;
$fn$;

comment on function public.age_group_is_adult(text) is
  'True when a team age group names itself an adult side (Open Age, Seniors, Vets, O45). A blank or unrecognised label is false -- the club has said nothing, which is not the same as saying adult.';

revoke all privileges on function public.age_group_band_range(text) from public, anon;
revoke all privileges on function public.age_group_is_adult(text) from public, anon;
grant execute on function public.age_group_band_range(text) to authenticated, service_role;
grant execute on function public.age_group_is_adult(text) to authenticated, service_role;


-- 3. The rule, re-stated over ranges ------------------------------------------
create or replace function public.may_register_for_team(p_person_id uuid, p_team_id uuid)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
as $fn$
declare
  v_dob    date;
  v_sex    text;
  v_gender text;
  v_group  text;
  v_band   integer;
  v_own    integer;
  v_range  int4range;
begin
  if p_team_id is null then
    return true;   -- a team-less registration: the club places them by hand
  end if;

  select p.dob, p.sex into v_dob, v_sex from public.people p where p.id = p_person_id;
  select t.gender, t.age_group into v_gender, v_group from public.teams t where t.id = p_team_id;

  -- The league's rule first: it is the one that binds everybody.
  if not public.team_admits_sex(v_sex, v_gender) then
    return false;
  end if;

  -- SG-0: an unknown date of birth is a minor, and a minor the club cannot
  -- place. Fail closed, whatever the team calls itself.
  if v_dob is null then
    return false;
  end if;

  v_band  := public.fa_age_band_today(v_dob);
  v_range := public.age_group_band_range(v_group);

  if v_band > 18 then
    -- An adult belongs in a team that names no youth band.
    return v_range is null;
  end if;

  v_own := greatest(v_band, 5);
  if v_range is not null then
    return v_range @> v_own or v_range @> (v_own + 1);
  end if;
  if public.age_group_is_adult(v_group) then
    return false;   -- a child is not registered into an adult side
  end if;
  -- The club has never recorded what this team is; there is no band to be
  -- outside of, so the database does not manufacture a refusal. The screen is
  -- stricter and does not offer it.
  return true;
end;
$fn$;

comment on function public.may_register_for_team(uuid, uuid) is
  'Own age band or the one above (a team may name a range), and the sex the team admits. A child is refused a team that names itself adult; an adult is refused any youth band; an unknown date of birth is refused (SG-0). Null team = true.';

revoke all privileges on function public.may_register_for_team(uuid, uuid) from public, anon;
grant execute on function public.may_register_for_team(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- ROLLBACK (documented, not executed)
-- =============================================================================
--   create or replace function public.may_register_for_team(uuid, uuid) ...
--     -- the body in 20260825500000_registration_team_rules.sql section 4
--   drop function if exists public.age_group_is_adult(text);
--   drop function if exists public.age_group_band_range(text);
-- =============================================================================
