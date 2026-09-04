-- =============================================================================
-- Subs a household can follow (Adam, 2026-09-04: "The subs setup is WAY too
-- complicated… let's settle on a more user-friendly process")
--
-- THE SETTLED PROCESS (Adam's answers, 2026-09-04):
--   * Individual vs family is decided BY PLAYERS, AUTOMATICALLY — two or more
--     playing members under the number is a family. Nobody ever picks.
--   * A member's ONLY choice is up-front or monthly.
--   * Monthly = the membership fee immediately, then subs on the 1st of each
--     following month, LAST PAYMENT 1 MAY in all cases. Joining later simply
--     means fewer instalments.
--   * Up-front = the same total the monthlies would add up to: membership fee
--     + monthly rate × instalments remaining. The two doors always agree.
--   * Renewal is with the season.
--   * Both doors: the treasurer enrols a household, or the lead member
--     self-serves.
--   * Fees are configured as SIX BOXES (individual/family membership,
--     individual/family monthly subs, yellow/red fine) — a facade over the
--     six plans 20260904180000 seeded, which now carry a `system_key` naming
--     which box they are. The plan builder stays for bespoke cohorts; the
--     system six cannot be deleted or reshaped, only repriced/renamed.
--
-- WHAT THIS MIGRATION ADDS
--   * `fee_plans.system_key` — stamps the six; a guard keeps their shape
--     (kind/scope/schedule immutable, deletion refused).
--   * `billing_agreements.season_id` — an enrolment belongs to a season; one
--     enrolment per account per season (partial unique on subs system plans).
--   * `household_fee_kind(account)` — the players-under-the-number rule.
--   * `subs_quote(account)` — the one sum, shown to member and treasurer
--     alike: scope, fees, instalment count and dates, both totals.
--   * `enroll_household(account, mode)` — the one door for both sides:
--     finance may enrol anyone, the lead member themself; writes the
--     membership charge immediately and either the paid-up-front subs charge
--     or the monthly agreement `run_billing_cycle()` (unchanged) collects.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy changes — three
-- new SECURITY DEFINER functions gated in-body, one guard trigger, two
-- columns); data touched: the six seeded plans gain their system_key (by
-- name, then by shape); rollback: §5 at the foot of this file.
-- =============================================================================


-- =============================================================================
-- 1. system plans
-- =============================================================================

alter table public.fee_plans add column system_key text unique
  check (system_key in ('membership_individual', 'membership_family',
                        'subs_monthly_individual', 'subs_monthly_family',
                        'fine_yellow', 'fine_red'));

update public.fee_plans set system_key = k.key
from (values
  ('Club membership — Individual', 'membership_individual'),
  ('Club membership — Family',     'membership_family'),
  ('Monthly subs — Individual',    'subs_monthly_individual'),
  ('Monthly subs — Family',        'subs_monthly_family'),
  ('Yellow card fine',             'fine_yellow'),
  ('Red card fine',                'fine_red')
) as k(name, key)
where fee_plans.name = k.name and fee_plans.system_key is null;

-- Fallback by shape, in case a seeded plan was renamed before this ran.
update public.fee_plans set system_key = 'membership_individual'
 where system_key is null and kind = 'membership' and scope = 'individual' and schedule = 'one_off'
   and not exists (select 1 from public.fee_plans f where f.system_key = 'membership_individual')
   and id = (select id from public.fee_plans f2 where f2.kind = 'membership' and f2.scope = 'individual' and f2.schedule = 'one_off' order by created_at limit 1);
update public.fee_plans set system_key = 'membership_family'
 where system_key is null and kind = 'membership' and scope = 'family' and schedule = 'one_off'
   and not exists (select 1 from public.fee_plans f where f.system_key = 'membership_family')
   and id = (select id from public.fee_plans f2 where f2.kind = 'membership' and f2.scope = 'family' and f2.schedule = 'one_off' order by created_at limit 1);
update public.fee_plans set system_key = 'subs_monthly_individual'
 where system_key is null and kind = 'subs' and scope = 'individual' and schedule = 'monthly'
   and not exists (select 1 from public.fee_plans f where f.system_key = 'subs_monthly_individual')
   and id = (select id from public.fee_plans f2 where f2.kind = 'subs' and f2.scope = 'individual' and f2.schedule = 'monthly' order by created_at limit 1);
update public.fee_plans set system_key = 'subs_monthly_family'
 where system_key is null and kind = 'subs' and scope = 'family' and schedule = 'monthly'
   and not exists (select 1 from public.fee_plans f where f.system_key = 'subs_monthly_family')
   and id = (select id from public.fee_plans f2 where f2.kind = 'subs' and f2.scope = 'family' and f2.schedule = 'monthly' order by created_at limit 1);

do $$
begin
  if (select count(*) from public.fee_plans where system_key is not null) < 4 then
    raise exception 'subs simplification: the system plans could not be identified — stamp fee_plans.system_key by hand and re-run';
  end if;
end $$;

-- The six keep their shape: repriced and renamed freely, never reshaped or
-- deleted — the enrolment arithmetic depends on what they are.
create or replace function public.fee_plans_system_guard()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.system_key is not null then
      raise exception 'fee_plans: % is a system plan — the fee boxes point at it; reprice or deactivate it instead', old.name
        using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.system_key is not null then
    if new.system_key is distinct from old.system_key
       or new.kind <> old.kind
       or new.scope is distinct from old.scope
       or new.schedule <> old.schedule then
      raise exception 'fee_plans: a system plan keeps its shape — only the price, name, description and active flag change'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_fee_plans_system_guard
  before update or delete on public.fee_plans
  for each row execute function public.fee_plans_system_guard();

revoke all privileges on function public.fee_plans_system_guard() from public, anon, authenticated, service_role;


-- =============================================================================
-- 2. enrolments belong to a season
-- =============================================================================

alter table public.billing_agreements
  add column season_id uuid references public.seasons (id) on delete restrict;

-- One enrolment per account per season — completed ones included, because a
-- household that paid up front is enrolled, not eligible again.
create unique index billing_agreements_one_enrolment_idx
  on public.billing_agreements (account_id, season_id)
  where season_id is not null and status in ('active', 'paused', 'completed');


-- =============================================================================
-- 3. THE RULE AND THE SUM
-- =============================================================================

-- Two or more playing members under the number is a family. A player is a
-- live squad place or a live registration in the current season — the same
-- pair of facts membership_kind_for() (20260825520000) counts, applied to the
-- billing household.
create or replace function public.household_fee_kind(p_account_id uuid)
  returns public.fee_plan_scope
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case when (
    select count(*)
      from public.billing_account_people bap
     where bap.account_id = p_account_id
       and bap.removed_at is null
       and (exists (select 1 from public.team_memberships tm
                     join public.seasons s on s.id = tm.season_id and s.is_current
                    where tm.person_id = bap.person_id and tm.role = 'player' and tm.left_at is null)
         or exists (select 1 from public.registrations r
                     join public.seasons s on s.id = r.season_id and s.is_current
                    where r.person_id = bap.person_id and r.status in ('pending', 'approved')))
  ) >= 2 then 'family'::public.fee_plan_scope else 'individual'::public.fee_plan_scope end;
$$;

-- The one sum. First instalment: the 1st of next month. Last: 1 May of the
-- season's closing year, in all cases (Adam). Enrolling after that year's
-- 1 May means zero instalments — membership fee only.
create or replace function public.subs_quote(p_account_id uuid)
  returns table (
    scope              public.fee_plan_scope,
    season_id          uuid,
    season_name        text,
    membership_plan_id uuid,
    membership_pence   integer,
    subs_plan_id       uuid,
    monthly_pence      integer,
    instalments        integer,
    first_on           date,
    last_on            date,
    total_pence        integer
  )
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_scope public.fee_plan_scope;
  v_season public.seasons%rowtype;
  v_membership public.fee_plans%rowtype;
  v_subs public.fee_plans%rowtype;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_first date;
  v_last date;
  v_count integer;
begin
  if auth.uid() is not null and not public.is_finance() and not public.on_billing_account(p_account_id) then
    raise exception 'subs_quote: your own household, or finance' using errcode = '42501';
  end if;
  select * into v_season from public.seasons s where s.is_current;
  if not found then
    raise exception 'subs_quote: no current season is set' using errcode = 'P0001';
  end if;
  v_scope := public.household_fee_kind(p_account_id);
  select * into v_membership from public.fee_plans
   where system_key = 'membership_' || v_scope::text and active;
  select * into v_subs from public.fee_plans
   where system_key = 'subs_monthly_' || v_scope::text and active;
  if v_membership.id is null or v_subs.id is null then
    raise exception 'subs_quote: the % fee plans are not active yet — set the fees first', v_scope using errcode = 'P0001';
  end if;

  v_first := (date_trunc('month', v_today) + interval '1 month')::date;
  v_last  := make_date(extract(year from v_season.ends_on)::int, 5, 1);
  v_count := greatest(0,
    (extract(year from v_last)::int * 12 + extract(month from v_last)::int)
    - (extract(year from v_first)::int * 12 + extract(month from v_first)::int) + 1);

  return query select
    v_scope, v_season.id, v_season.name,
    v_membership.id, v_membership.amount_pence,
    v_subs.id, v_subs.amount_pence,
    v_count,
    case when v_count > 0 then v_first end,
    case when v_count > 0 then v_last end,
    v_membership.amount_pence + v_subs.amount_pence * v_count;
end;
$$;


-- =============================================================================
-- 4. THE ONE DOOR
-- =============================================================================

create or replace function public.enroll_household(
  p_account_id uuid,
  p_mode text
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_lead uuid;
  v_quote record;
  v_agreement uuid;
  v_status public.agreement_status;
begin
  if p_mode not in ('upfront', 'monthly') then
    raise exception 'enroll_household: mode is upfront or monthly' using errcode = 'P0001';
  end if;
  select lead_person_id into v_lead from public.billing_accounts where id = p_account_id;
  if v_lead is null then
    raise exception 'enroll_household: no such account' using errcode = 'P0001';
  end if;
  if auth.uid() is not null and not public.is_finance()
     and v_lead is distinct from public.current_person_id() then
    raise exception 'enroll_household: only the lead member or finance enrols a household' using errcode = '42501';
  end if;

  select * into v_quote from public.subs_quote(p_account_id);

  if exists (select 1 from public.billing_agreements ba
              where ba.account_id = p_account_id and ba.season_id = v_quote.season_id
                and ba.status in ('active', 'paused', 'completed')) then
    raise exception 'enroll_household: this household is already enrolled for %', v_quote.season_name
      using errcode = 'P0001';
  end if;

  -- Monthly with instalments still to come stays active for the cycle;
  -- everything else is complete the moment it is written.
  v_status := case when p_mode = 'monthly' and v_quote.instalments > 0
                   then 'active'::public.agreement_status
                   else 'completed'::public.agreement_status end;

  insert into public.billing_agreements
    (account_id, plan_id, status, season_id, next_charge_on, months_total,
     months_charged, auto_collect)
  values
    (p_account_id, v_quote.subs_plan_id, v_status, v_quote.season_id,
     case when v_status = 'active' then v_quote.first_on end,
     nullif(v_quote.instalments, 0),
     case when p_mode = 'upfront' then v_quote.instalments else 0 end,
     true)
  returning id into v_agreement;

  -- The membership fee is owed the moment a household enrols, either way.
  insert into public.charges (account_id, agreement_id, plan_id, kind, description, amount_pence, due_on)
  values (p_account_id, v_agreement, v_quote.membership_plan_id, 'membership',
          v_quote.season_name || ' membership — ' || initcap(v_quote.scope::text),
          v_quote.membership_pence, (now() at time zone 'Europe/London')::date);

  -- Up front: the season's subs as one charge, same total the monthlies
  -- would have reached.
  if p_mode = 'upfront' and v_quote.instalments > 0 then
    insert into public.charges (account_id, agreement_id, plan_id, kind, description, amount_pence, due_on)
    values (p_account_id, v_agreement, v_quote.subs_plan_id, 'subs',
            v_quote.season_name || ' subs — ' || v_quote.instalments || ' months, paid up front',
            v_quote.monthly_pence * v_quote.instalments, (now() at time zone 'Europe/London')::date);
  end if;

  perform public.write_audit('finance.enrolled', 'billing_agreements', v_agreement::text,
    jsonb_build_object('account_id', p_account_id, 'mode', p_mode, 'scope', v_quote.scope,
                       'season_id', v_quote.season_id, 'instalments', v_quote.instalments,
                       'total_pence', v_quote.total_pence));
  return v_agreement;
end;
$$;

revoke all privileges on function public.household_fee_kind(uuid) from public, anon, authenticated;
revoke all privileges on function public.subs_quote(uuid) from public, anon;
revoke all privileges on function public.enroll_household(uuid, text) from public, anon;
grant execute on function public.household_fee_kind(uuid) to service_role;
grant execute on function public.subs_quote(uuid) to authenticated, service_role;
grant execute on function public.enroll_household(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 5. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop function enroll_household, subs_quote, household_fee_kind;
-- drop trigger trg_fee_plans_system_guard on fee_plans;
-- drop function fee_plans_system_guard;
-- drop index billing_agreements_one_enrolment_idx;
-- alter table billing_agreements drop column season_id;
-- alter table fee_plans drop column system_key;
