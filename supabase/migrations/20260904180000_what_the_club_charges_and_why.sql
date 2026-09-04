-- =============================================================================
-- What the club charges, and why (Adam, 2026-09-04)
--
-- "Create a fully functional finance section … in anticipation of us taking
--  subs through there. … bespoke membership options for different membership
--  cohorts, as well as one-offs (can these be pre-authorised?) for yellow and
--  red cards. Use Sumup for card collections. Option to pay up-front or
--  monthly. … As a minimum, we need a club membership fee and a monthly subs,
--  individual and family."
--
-- THE MODEL — four tables on the billing spine of 20260904170000:
--
--   * `fee_plans` — what the club can charge for. Fully bespoke: name, cohort
--     tag (free text — "U7–U11", "Veterans", "Social"), kind (membership |
--     subs | fine | other), scope (individual | family, NULL where the idea
--     does not apply), amount, schedule (one_off | monthly | annual). The
--     yellow/red card fines are plans too — a one-off is a plan with schedule
--     'one_off', so the price is set once and every fine raised from it is
--     consistent.
--
--   * `billing_agreements` — an account signed up to a plan. A monthly plan
--     produces a charge each month (`next_charge_on` walks forward, capped by
--     `months_total` when the plan says so); an annual plan produces one a
--     year; a one-off produces exactly one charge and completes on the spot.
--     "Up-front or monthly" = the same fee offered as two plans; the member
--     picks the agreement they want.
--
--   * `charges` — what an account owes. Every charge names the account that
--     owes it (the LEAD MEMBER pays — membership is at the bill-payer, always)
--     and optionally the person who incurred it (the player who collected the
--     yellow card). `charge_no` is an identity — 'CHG-1042' is the reference
--     Xero sees. Status: pending → paid (derived from the ledger, below) |
--     waived (with a written reason) | void.
--
--   * `payment_mandates` — a stored SumUp payment instrument for an account
--     (created by a SETUP_RECURRING_PAYMENT checkout, charged server-side for
--     monthly collections). `covers_fines` is the pre-authorisation Adam asked
--     about: the lead member's standing consent for one-off fines to be taken
--     from the stored card without a fresh checkout. Consent is recorded
--     (`consented_at`/`consented_by`) and revocable.
--
--   * `payments` (the one ledger, P1.5/P4.1) gains its third link: `charge_id`.
--     `payments_one_link` now says at most one of booking / subscription /
--     charge; the kind trigger learns the branch; `sumup_checkout_id` gets the
--     unique index app-code idempotency was quietly relying on.
--
-- PAID IS ARITHMETIC, NOT OPINION. `charges.status` moves to 'paid' only when
-- the ledger covers the amount (`settle_charge()` fires on payment insert and
-- refund update, both directions). A treasurer who wants a charge gone without
-- money records a waiver, with a reason, on the record.
--
-- WHO SEES WHAT
--   The `finance` role (with club_admin) reads everything financial: accounts,
--   plans, agreements, charges, mandates, the whole payments ledger, and — new
--   policy — `people` (a treasurer reconciling subs needs to know who a charge
--   is for; noted in the PR's §11 review). Members see their own: every live
--   person on an account reads that account's agreements and charges, and the
--   payments against them, in real time (Realtime rides RLS, so the phone in
--   the pocket sees the payment land the moment it is recorded).
--
-- REPORTING SPINE: three security_invoker views (account summary, aging
-- buckets, income by month) — the Finance screens and the Xero export read
-- these under the caller's own RLS.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (new tables with their
-- policies; `people` gains a finance read; `payments` gains finance +
-- account-member reads); data touched: six seeded fee plans (inactive,
-- placeholder prices for Adam to set) and five site_settings keys; rollback:
-- §10 at the foot of this file.
-- =============================================================================


-- =============================================================================
-- 1. ENUMS
-- =============================================================================

create type public.charge_kind     as enum ('membership', 'subs', 'fine', 'other');
create type public.fee_plan_scope  as enum ('individual', 'family');
create type public.fee_schedule    as enum ('one_off', 'monthly', 'annual');
create type public.agreement_status as enum ('active', 'paused', 'completed', 'cancelled');
create type public.charge_status   as enum ('pending', 'paid', 'waived', 'void');
create type public.mandate_status  as enum ('pending', 'active', 'revoked', 'failed');


-- =============================================================================
-- 2. fee_plans
-- =============================================================================

create table public.fee_plans (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  cohort       text,
  kind         public.charge_kind not null default 'other',
  scope        public.fee_plan_scope,
  amount_pence integer not null check (amount_pence > 0),
  schedule     public.fee_schedule not null default 'one_off',
  months_total integer check (months_total is null or months_total between 1 and 24),
  active       boolean not null default true,
  sort         integer not null default 100,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now(),
  constraint fee_plans_name_not_blank check (btrim(name) <> ''),
  constraint fee_plans_months_only_monthly check (months_total is null or schedule = 'monthly')
);

create trigger trg_fee_plans_updated
  before update on public.fee_plans
  for each row execute function public.set_updated_at();

comment on table public.fee_plans is
  'Everything the club can charge for: bespoke membership options per cohort, subs, one-off fines. A price lives here so every charge raised from it is consistent.';


-- =============================================================================
-- 3. billing_agreements
-- =============================================================================

create table public.billing_agreements (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.billing_accounts (id) on delete restrict,
  plan_id         uuid not null references public.fee_plans (id) on delete restrict,
  status          public.agreement_status not null default 'active',
  start_on        date not null default current_date,
  next_charge_on  date,
  months_total    integer,
  months_charged  integer not null default 0,
  auto_collect    boolean not null default false,
  cancel_reason   text,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

create index billing_agreements_account_idx on public.billing_agreements (account_id);
create index billing_agreements_due_idx on public.billing_agreements (next_charge_on)
  where status = 'active' and next_charge_on is not null;
-- One live agreement per account per plan.
create unique index billing_agreements_live_idx on public.billing_agreements (account_id, plan_id)
  where status in ('active', 'paused');

create trigger trg_billing_agreements_updated
  before update on public.billing_agreements
  for each row execute function public.set_updated_at();

comment on table public.billing_agreements is
  'An account signed up to a plan: monthly walks next_charge_on forward, annual yearly, one_off charges once and completes.';


-- =============================================================================
-- 4. charges
-- =============================================================================

create table public.charges (
  id            uuid primary key default gen_random_uuid(),
  charge_no     bigint generated always as identity,
  account_id    uuid not null references public.billing_accounts (id) on delete restrict,
  agreement_id  uuid references public.billing_agreements (id) on delete restrict,
  plan_id       uuid references public.fee_plans (id) on delete restrict,
  person_id     uuid references public.people (id) on delete restrict,
  kind          public.charge_kind not null default 'other',
  description   text not null,
  amount_pence  integer not null check (amount_pence > 0),
  due_on        date not null default current_date,
  status        public.charge_status not null default 'pending',
  waived_reason text,
  waived_by     uuid references auth.users (id) on delete set null,
  waived_at     timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  constraint charges_description_not_blank check (btrim(description) <> ''),
  constraint charges_no_unique unique (charge_no),
  constraint charges_waive_needs_reason
    check (status <> 'waived' or (waived_reason is not null and btrim(waived_reason) <> ''))
);

create index charges_account_idx on public.charges (account_id, status);
create index charges_due_idx on public.charges (due_on) where status = 'pending';
create index charges_agreement_idx on public.charges (agreement_id) where agreement_id is not null;

create trigger trg_charges_updated
  before update on public.charges
  for each row execute function public.set_updated_at();

-- Financial records: never hard-deleted, never truncated (SG-2 treatment —
-- the ledger hangs off these rows).
create trigger trg_charges_no_delete
  before delete on public.charges
  for each row execute function public.deny_hard_delete();
create trigger trg_charges_no_truncate
  before truncate on public.charges
  for each statement execute function public.deny_truncate();

comment on table public.charges is
  'What an account owes and why. Billed to the lead member always; person_id names who incurred it (the player with the yellow card). CHG-<charge_no> is the reference Xero sees.';


-- =============================================================================
-- 5. payment_mandates
-- =============================================================================

create table public.payment_mandates (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.billing_accounts (id) on delete restrict,
  sumup_customer_id  text not null,
  sumup_checkout_id  text,
  card_last4         text,
  card_type          text,
  status             public.mandate_status not null default 'pending',
  covers_fines       boolean not null default false,
  consented_at       timestamptz,
  consented_by       uuid references auth.users (id) on delete set null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One live mandate per account: the card on file.
create unique index payment_mandates_live_idx on public.payment_mandates (account_id)
  where status in ('pending', 'active');

create trigger trg_payment_mandates_updated
  before update on public.payment_mandates
  for each row execute function public.set_updated_at();

create trigger trg_payment_mandates_no_delete
  before delete on public.payment_mandates
  for each row execute function public.deny_hard_delete();
create trigger trg_payment_mandates_no_truncate
  before truncate on public.payment_mandates
  for each statement execute function public.deny_truncate();

comment on table public.payment_mandates is
  'A stored SumUp payment instrument for an account. covers_fines = the lead member''s recorded, revocable pre-authorisation for one-off fines to be collected without a fresh checkout.';


-- =============================================================================
-- 6. payments — the third link
-- =============================================================================

alter table public.payments
  add column charge_id uuid references public.charges (id) on delete restrict,
  drop constraint payments_one_link,
  add constraint payments_one_link check (
    (booking_id is not null)::int + (subscription_id is not null)::int + (charge_id is not null)::int <= 1);

create index payments_charge_idx on public.payments (charge_id) where charge_id is not null;
-- The idempotency app code was checking with a SELECT becomes a real constraint.
create unique index payments_sumup_checkout_idx on public.payments (sumup_checkout_id)
  where sumup_checkout_id is not null;

create or replace function public.payments_kind_guard()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  new.kind := case when new.booking_id is not null then 'hire'
                   when new.subscription_id is not null then 'subscription'
                   when new.charge_id is not null then 'charge'
                   else 'other' end;
  return new;
end;
$$;

-- The existing trigger fires on insert or update OF booking_id, subscription_id;
-- recreate it to watch charge_id too.
drop trigger trg_payments_kind on public.payments;
create trigger trg_payments_kind
  before insert or update of booking_id, subscription_id, charge_id on public.payments
  for each row execute function public.payments_kind_guard();


-- =============================================================================
-- 7. PAID IS ARITHMETIC — settle_charge()
-- =============================================================================

create or replace function public.settle_charge(p_charge_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_amount integer;
  v_status public.charge_status;
  v_paid   integer;
begin
  select amount_pence, status into v_amount, v_status
    from public.charges where id = p_charge_id for update;
  if not found or v_status in ('waived', 'void') then
    return;
  end if;
  select coalesce(sum(amount_pence - refunded_pence), 0) into v_paid
    from public.payments where charge_id = p_charge_id;
  if v_paid >= v_amount and v_status <> 'paid' then
    update public.charges set status = 'paid' where id = p_charge_id;
  elsif v_paid < v_amount and v_status = 'paid' then
    update public.charges set status = 'pending' where id = p_charge_id;
  end if;
end;
$$;

create or replace function public.payments_settle_charge()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.charge_id is not null then
    perform public.settle_charge(new.charge_id);
  end if;
  if tg_op = 'UPDATE' and old.charge_id is not null and old.charge_id is distinct from new.charge_id then
    perform public.settle_charge(old.charge_id);
  end if;
  return null;
end;
$$;

create trigger trg_payments_settle_charge
  after insert or update of amount_pence, refunded_pence, charge_id on public.payments
  for each row execute function public.payments_settle_charge();


-- =============================================================================
-- 8. GUARDS + THE WORKING FUNCTIONS
-- =============================================================================

create or replace function public.charges_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.status not in ('pending') then
      raise exception 'charges: a charge starts pending' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.account_id <> old.account_id or new.charge_no <> old.charge_no then
    raise exception 'charges: a charge stays with the account it was raised on' using errcode = 'P0001';
  end if;
  if new.amount_pence <> old.amount_pence
     and exists (select 1 from public.payments p where p.charge_id = old.id) then
    raise exception 'charges: the amount is immutable once money has moved — refund and re-raise' using errcode = 'P0001';
  end if;
  if new.status = 'paid' and old.status <> 'paid' then
    -- Only arithmetic makes a charge paid. settle_charge() satisfies this
    -- check by construction; a human who wants it gone without money waives.
    if (select coalesce(sum(p.amount_pence - p.refunded_pence), 0) from public.payments p where p.charge_id = old.id)
       < old.amount_pence then
      raise exception 'charges: paid is derived from the ledger — record a payment, or waive with a reason' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'void' and old.status = 'paid' then
    raise exception 'charges: a paid charge cannot be voided — refund it' using errcode = 'P0001';
  end if;
  if new.status = 'waived' and old.status <> 'waived' then
    new.waived_by := coalesce(new.waived_by, auth.uid());
    new.waived_at := coalesce(new.waived_at, now());
  end if;
  return new;
end;
$$;

create trigger trg_charges_guard
  before insert or update on public.charges
  for each row execute function public.charges_guard();

-- Raise a charge against the account a person sits under. The one door for
-- fines and ad-hoc charges: hand it the player, it bills the bill-payer.
create or replace function public.raise_charge(
  p_person_id    uuid,
  p_plan_id      uuid default null,
  p_description  text default null,
  p_amount_pence integer default null,
  p_due_on       date default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_account uuid;
  v_plan    public.fee_plans%rowtype;
  v_id      uuid;
  v_desc    text;
  v_amount  integer;
  v_kind    public.charge_kind := 'other';
begin
  if auth.uid() is not null and not public.is_finance() then
    raise exception 'raise_charge: finance or club_admin only' using errcode = '42501';
  end if;
  select bap.account_id into v_account
    from public.billing_account_people bap
   where bap.person_id = p_person_id and bap.removed_at is null;
  if v_account is null then
    raise exception 'raise_charge: % has no membership number — issue one first', p_person_id using errcode = 'P0001';
  end if;
  if p_plan_id is not null then
    select * into v_plan from public.fee_plans where id = p_plan_id;
    if not found then
      raise exception 'raise_charge: no such plan' using errcode = 'P0001';
    end if;
    v_desc   := coalesce(p_description, v_plan.name);
    v_amount := coalesce(p_amount_pence, v_plan.amount_pence);
    v_kind   := v_plan.kind;
  else
    v_desc   := p_description;
    v_amount := p_amount_pence;
  end if;
  if v_desc is null or v_amount is null then
    raise exception 'raise_charge: a bespoke charge needs a description and an amount' using errcode = 'P0001';
  end if;
  insert into public.charges (account_id, plan_id, person_id, kind, description, amount_pence, due_on)
  values (v_account, p_plan_id, p_person_id, v_kind, v_desc, v_amount, coalesce(p_due_on, current_date))
  returning id into v_id;
  perform public.write_audit('finance.charge_raised', 'charges', v_id::text,
    jsonb_build_object('account_id', v_account, 'person_id', p_person_id, 'plan_id', p_plan_id,
                       'amount_pence', v_amount, 'kind', v_kind));
  return v_id;
end;
$$;

-- Sign an account up to a plan. The lead member may do it for their own
-- account (the self-service "pay monthly" button); finance for anyone.
create or replace function public.start_agreement(
  p_account_id   uuid,
  p_plan_id      uuid,
  p_auto_collect boolean default false
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_plan public.fee_plans%rowtype;
  v_lead uuid;
  v_id   uuid;
  v_desc text;
begin
  select lead_person_id into v_lead from public.billing_accounts where id = p_account_id;
  if v_lead is null then
    raise exception 'start_agreement: no such account' using errcode = 'P0001';
  end if;
  if auth.uid() is not null and not public.is_finance()
     and v_lead is distinct from public.current_person_id() then
    raise exception 'start_agreement: only the lead member or finance can sign an account up' using errcode = '42501';
  end if;
  select * into v_plan from public.fee_plans where id = p_plan_id;
  if not found or not v_plan.active then
    raise exception 'start_agreement: no such active plan' using errcode = 'P0001';
  end if;

  if v_plan.schedule = 'one_off' then
    -- One charge, agreement complete on the spot.
    insert into public.billing_agreements (account_id, plan_id, status, next_charge_on, months_total, months_charged, auto_collect)
    values (p_account_id, p_plan_id, 'completed', null, null, 0, p_auto_collect)
    returning id into v_id;
    insert into public.charges (account_id, agreement_id, plan_id, kind, description, amount_pence, due_on)
    values (p_account_id, v_id, p_plan_id, v_plan.kind, v_plan.name, v_plan.amount_pence, current_date);
  else
    insert into public.billing_agreements (account_id, plan_id, status, next_charge_on, months_total, auto_collect)
    values (p_account_id, p_plan_id, 'active', current_date, v_plan.months_total, p_auto_collect)
    returning id into v_id;
  end if;
  perform public.write_audit('finance.agreement_started', 'billing_agreements', v_id::text,
    jsonb_build_object('account_id', p_account_id, 'plan_id', p_plan_id, 'schedule', v_plan.schedule,
                       'auto_collect', p_auto_collect));
  return v_id;
end;
$$;

-- The billing cycle: raise every charge that has come due. Idempotent per day
-- by construction (next_charge_on only ever moves forward). service_role only
-- — the cron route calls it, then attempts SumUp auto-collection app-side.
create or replace function public.run_billing_cycle()
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_agreement record;
  v_raised integer := 0;
  v_label text;
begin
  for v_agreement in
    select ba.id, ba.account_id, ba.plan_id, ba.next_charge_on, ba.months_total, ba.months_charged,
           fp.kind, fp.name, fp.amount_pence, fp.schedule
      from public.billing_agreements ba
      join public.fee_plans fp on fp.id = ba.plan_id
     where ba.status = 'active' and ba.next_charge_on is not null
       and ba.next_charge_on <= current_date
     order by ba.created_at
     for update of ba
  loop
    v_label := v_agreement.name || ' — ' || to_char(v_agreement.next_charge_on, 'FMMonth YYYY');
    insert into public.charges (account_id, agreement_id, plan_id, kind, description, amount_pence, due_on)
    values (v_agreement.account_id, v_agreement.id, v_agreement.plan_id, v_agreement.kind,
            v_label, v_agreement.amount_pence, v_agreement.next_charge_on);
    v_raised := v_raised + 1;

    if v_agreement.schedule = 'monthly' then
      if v_agreement.months_total is not null and v_agreement.months_charged + 1 >= v_agreement.months_total then
        update public.billing_agreements
           set months_charged = months_charged + 1, next_charge_on = null, status = 'completed'
         where id = v_agreement.id;
      else
        update public.billing_agreements
           set months_charged = months_charged + 1, next_charge_on = next_charge_on + interval '1 month'
         where id = v_agreement.id;
      end if;
    else  -- annual
      update public.billing_agreements
         set months_charged = months_charged + 1, next_charge_on = next_charge_on + interval '1 year'
       where id = v_agreement.id;
    end if;
  end loop;
  if v_raised > 0 then
    perform public.write_audit('finance.billing_cycle', 'charges', null,
      jsonb_build_object('charges_raised', v_raised));
  end if;
  return v_raised;
end;
$$;


-- =============================================================================
-- 9. WHO SEES WHAT — RLS, capability, name surface
-- =============================================================================

alter table public.fee_plans          enable row level security;
alter table public.billing_agreements enable row level security;
alter table public.charges            enable row level security;
alter table public.payment_mandates   enable row level security;

-- Plans: members see what is on offer; finance manages the catalogue.
create policy "fee_plans_read" on public.fee_plans for select to authenticated
  using (active or public.is_finance());
create policy "fee_plans_finance_write" on public.fee_plans for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

-- A member of the household reads their account's agreements and charges.
create policy "billing_agreements_read" on public.billing_agreements for select to authenticated
  using (public.is_finance() or public.on_billing_account(account_id));
create policy "billing_agreements_finance_write" on public.billing_agreements for update to authenticated
  using (public.is_finance()) with check (public.is_finance());

create policy "charges_read" on public.charges for select to authenticated
  using (public.is_finance() or public.on_billing_account(account_id));
create policy "charges_finance_insert" on public.charges for insert to authenticated
  with check (public.is_finance());
create policy "charges_finance_update" on public.charges for update to authenticated
  using (public.is_finance()) with check (public.is_finance());

-- Mandates: the lead member and finance. Card data is last4 + brand only.
create policy "payment_mandates_read" on public.payment_mandates for select to authenticated
  using (public.is_finance()
         or exists (select 1 from public.billing_accounts a
                     where a.id = payment_mandates.account_id
                       and a.lead_person_id = public.current_person_id()));
create policy "payment_mandates_finance_update" on public.payment_mandates for update to authenticated
  using (public.is_finance()) with check (public.is_finance());

-- Payments: finance reads the whole ledger (reconciliation is the job);
-- household members read payments on their account's charges — in real time.
create policy "payments_finance_read" on public.payments for select to authenticated
  using (public.is_finance());
create policy "payments_charge_read" on public.payments for select to authenticated
  using (charge_id is not null and exists (
    select 1 from public.charges c
   where c.id = payments.charge_id
     and public.on_billing_account(c.account_id)));
create policy "payments_finance_write" on public.payments for insert to authenticated
  with check (public.is_finance() and charge_id is not null);
create policy "payments_finance_update" on public.payments for update to authenticated
  using (public.is_finance() and charge_id is not null)
  with check (public.is_finance() and charge_id is not null);

-- The treasurer can put a name to a charge. Contact and DOB come with the
-- row; the §11 review in the PR carries the reasoning. No write.
create policy "people_finance_read" on public.people for select to authenticated
  using (public.is_finance());

-- display_name() learns the finance gate, so the reporting views can carry
-- names for the treasurer. Body otherwise carried forward from 20260823170000.
create or replace function public.display_name(p_person_id uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
    when public.can_act_for(p_person_id)
      or public.is_finance()
      or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[])
      or exists (select 1 from public.team_memberships m
                 where m.person_id = p_person_id and m.left_at is null and public.is_team_staff(m.team_id))
    then (select first_name || ' ' || last_name from public.people where id = p_person_id)
    else null end;
$$;

-- my_capabilities() gains has_finance_role. Every other key carried forward
-- VERBATIM from 20260825310000 — replacing this function with an older body
-- quietly revokes capabilities, which CI has caught before.
create or replace function public.my_capabilities()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  with me as (select public.current_person_id() as person_id)
  select jsonb_build_object(
    'person_id', me.person_id,
    'is_club_admin', public.is_club_admin(),
    'is_safeguarding_lead', public.is_safeguarding_lead(),
    'has_finance_role', public.is_finance(),
    -- The 20260825070000 rule: a coach of a U-band team holds it without a
    -- grant. Carried forward verbatim — replacing this function with an older
    -- body would quietly revoke that, which is what CI caught.
    'has_waiting_list_access', exists (
      select 1 from public.waiting_list_access w where w.person_id = me.person_id)
      or exists (
      select 1 from public.team_memberships m
      join public.teams t on t.id = m.team_id
      where m.person_id = me.person_id and m.left_at is null
        and m.role in ('coach', 'assistant_coach', 'manager')
        and public.waiting_list_age_number(t.age_group) is not null),
    'has_coach_role', exists (
      select 1 from public.person_roles r
      where r.person_id = me.person_id and r.revoked_at is null and r.role = 'coach'),
    'has_parent_role', exists (
      select 1 from public.person_roles r
      where r.person_id = me.person_id and r.revoked_at is null and r.role = 'parent'),
    'has_referee_role', exists (
      select 1 from public.person_roles r
      where r.person_id = me.person_id and r.revoked_at is null and r.role = 'referee'),
    'is_team_staff', exists (
      select 1 from public.team_memberships m
      where m.person_id = me.person_id and m.left_at is null
        and m.role in ('coach', 'assistant_coach', 'manager')),
    'has_player_membership', exists (
      select 1 from public.team_memberships m
      where m.person_id = me.person_id and m.left_at is null and m.role = 'player'),
    'is_guardian', exists (
      select 1 from public.guardianships g
      where g.guardian_person_id = me.person_id and g.ended_at is null),
    'staff_teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
      from (select distinct m.team_id from public.team_memberships m
            where m.person_id = me.person_id and m.left_at is null
              and m.role in ('coach', 'assistant_coach', 'manager')) s
      join public.teams t on t.id = s.team_id), '[]'::jsonb),
    'player_teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
      from (select distinct m.team_id from public.team_memberships m
            where m.person_id = me.person_id and m.left_at is null and m.role = 'player') s
      join public.teams t on t.id = s.team_id), '[]'::jsonb),
    'parent_teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'children', s.children) order by t.name)
      from (select m.team_id,
                   jsonb_agg(distinct p.first_name || ' ' || p.last_name) as children
            from public.guardianships g
            join public.team_memberships m on m.person_id = g.child_person_id and m.left_at is null
            join public.people p on p.id = g.child_person_id and p.deleted_at is null
            where g.guardian_person_id = me.person_id and g.ended_at is null
            group by m.team_id) s
      join public.teams t on t.id = s.team_id), '[]'::jsonb)
  )
  from me;
$$;


-- =============================================================================
-- 10. REPORTING VIEWS (security_invoker — the caller's own RLS decides)
-- =============================================================================

create or replace view public.finance_account_summary
  with (security_invoker = true) as
  select a.id as account_id,
         a.member_no,
         lpad(a.member_no::text, 5, '0') as member_no_display,
         a.lead_person_id,
         public.display_name(a.lead_person_id) as lead_name,
         a.status,
         (select count(*) from public.billing_account_people bap
           where bap.account_id = a.id and bap.removed_at is null)::integer as people_count,
         coalesce(c.charged_pence, 0)::integer as charged_pence,
         coalesce(c.paid_pence, 0)::integer as paid_pence,
         (coalesce(c.charged_pence, 0) - coalesce(c.paid_pence, 0))::integer as balance_pence,
         coalesce(c.overdue_pence, 0)::integer as overdue_pence,
         c.oldest_due_on
    from public.billing_accounts a
    left join lateral (
      select sum(ch.amount_pence) filter (where ch.status in ('pending', 'paid')) as charged_pence,
             sum(p.paid) as paid_pence,
             sum(ch.amount_pence) filter (where ch.status = 'pending' and ch.due_on < current_date)
               - coalesce(sum(p.paid) filter (where ch.status = 'pending' and ch.due_on < current_date), 0) as overdue_pence,
             min(ch.due_on) filter (where ch.status = 'pending') as oldest_due_on
        from public.charges ch
        left join lateral (
          select coalesce(sum(py.amount_pence - py.refunded_pence), 0) as paid
            from public.payments py where py.charge_id = ch.id) p on true
       where ch.account_id = a.id
    ) c on true;

create or replace view public.finance_aging
  with (security_invoker = true) as
  select ch.account_id,
         a.member_no,
         public.display_name(a.lead_person_id) as lead_name,
         sum(out_pence) filter (where ch.due_on >= current_date)::integer                                       as not_due_pence,
         sum(out_pence) filter (where ch.due_on <  current_date and ch.due_on >= current_date - 30)::integer    as d30_pence,
         sum(out_pence) filter (where ch.due_on <  current_date - 30 and ch.due_on >= current_date - 60)::integer as d60_pence,
         sum(out_pence) filter (where ch.due_on <  current_date - 60 and ch.due_on >= current_date - 90)::integer as d90_pence,
         sum(out_pence) filter (where ch.due_on <  current_date - 90)::integer                                  as d90_plus_pence,
         sum(out_pence)::integer as outstanding_pence
    from public.charges ch
    join public.billing_accounts a on a.id = ch.account_id
    cross join lateral (
      select greatest(ch.amount_pence - coalesce((
               select sum(py.amount_pence - py.refunded_pence)
                 from public.payments py where py.charge_id = ch.id), 0), 0) as out_pence) o
   where ch.status = 'pending'
   group by ch.account_id, a.member_no, a.lead_person_id
  having sum(out_pence) > 0;

create or replace view public.finance_income_by_month
  with (security_invoker = true) as
  select date_trunc('month', py.paid_at)::date as month,
         py.kind,
         ch.plan_id,
         fp.name as plan_name,
         count(*)::integer as payment_count,
         sum(py.amount_pence - py.refunded_pence)::integer as net_pence
    from public.payments py
    left join public.charges ch on ch.id = py.charge_id
    left join public.fee_plans fp on fp.id = ch.plan_id
   where py.paid_at is not null
   group by 1, 2, 3, 4;


-- =============================================================================
-- 11. GRANTS
-- =============================================================================

revoke all privileges on public.fee_plans, public.billing_agreements, public.charges, public.payment_mandates
  from anon, authenticated, service_role;
grant select, insert, update, delete on public.fee_plans to authenticated;  -- RLS: finance only writes; delete allowed while nothing references a plan
grant select, update on public.billing_agreements to authenticated;
grant select, insert, update on public.charges to authenticated;
grant select, update on public.payment_mandates to authenticated;
grant select, insert, update on public.fee_plans, public.billing_agreements, public.charges, public.payment_mandates to service_role;
grant delete on public.fee_plans to service_role;
grant select on public.finance_account_summary, public.finance_aging, public.finance_income_by_month to authenticated, service_role;

revoke all privileges on function public.settle_charge(uuid) from public, anon, authenticated;
revoke all privileges on function public.payments_settle_charge() from public, anon, authenticated, service_role;
revoke all privileges on function public.charges_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.raise_charge(uuid, uuid, text, integer, date) from public, anon;
revoke all privileges on function public.start_agreement(uuid, uuid, boolean) from public, anon;
revoke all privileges on function public.run_billing_cycle() from public, anon, authenticated;
grant execute on function public.settle_charge(uuid) to service_role;
grant execute on function public.raise_charge(uuid, uuid, text, integer, date) to authenticated, service_role;
grant execute on function public.start_agreement(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.run_billing_cycle() to service_role;


-- =============================================================================
-- 12. SEEDS — the minimum plans (INACTIVE, placeholder prices) and settings
-- =============================================================================

-- Adam sets real prices in Finance → Plans and activates; the descriptions say
-- so out loud so a placeholder cannot quietly become a real fee.
insert into public.fee_plans (name, cohort, kind, scope, amount_pence, schedule, months_total, active, sort, description)
select v.* from (values
  ('Club membership — Individual', null::text, 'membership'::public.charge_kind, 'individual'::public.fee_plan_scope, 2000, 'one_off'::public.fee_schedule, null::integer, false, 10, 'PLACEHOLDER PRICE — set the real fee and activate.'),
  ('Club membership — Family',     null, 'membership', 'family',     3000, 'one_off', null, false, 20, 'PLACEHOLDER PRICE — set the real fee and activate.'),
  ('Monthly subs — Individual',    null, 'subs',       'individual', 1500, 'monthly', null, false, 30, 'PLACEHOLDER PRICE — set the real fee and activate.'),
  ('Monthly subs — Family',        null, 'subs',       'family',     2500, 'monthly', null, false, 40, 'PLACEHOLDER PRICE — set the real fee and activate.'),
  ('Yellow card fine',             null, 'fine',       null,         1000, 'one_off', null, false, 50, 'PLACEHOLDER PRICE — set the real fine and activate.'),
  ('Red card fine',                null, 'fine',       null,         3000, 'one_off', null, false, 60, 'PLACEHOLDER PRICE — set the real fine and activate.')
) as v(name, cohort, kind, scope, amount_pence, schedule, months_total, active, sort, description)
where not exists (select 1 from public.fee_plans fp where fp.name = v.name);

-- Xero export mapping: which Xero account code each charge kind posts to, and
-- the tax type. Editable in Finance → Settings.
-- "Members should be able to see their payments in real time" — charges and
-- payments join the realtime publication; RLS decides who hears what, exactly
-- as messages does (20260823260000).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'payments') then
    alter publication supabase_realtime add table public.payments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'charges') then
    alter publication supabase_realtime add table public.charges;
  end if;
end $$;

insert into public.site_settings (key, value) values
  ('finance.xero_account_membership', '200'),
  ('finance.xero_account_subs',       '201'),
  ('finance.xero_account_fine',       '202'),
  ('finance.xero_account_hire',       '203'),
  ('finance.xero_account_other',      '204'),
  ('finance.xero_tax_type',           'No VAT')
on conflict (key) do nothing;

notify pgrst, 'reload schema';


-- =============================================================================
-- 13. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop view finance_income_by_month, finance_aging, finance_account_summary;
-- restore my_capabilities()/display_name() bodies from 20260825310000 /
-- 20260823170000; drop policy people_finance_read on people; drop policies
-- payments_finance_read/payments_charge_read/payments_finance_write/
-- payments_finance_update on payments; drop function run_billing_cycle,
-- start_agreement, raise_charge, charges_guard, payments_settle_charge,
-- settle_charge; drop trigger trg_payments_settle_charge on payments;
-- recreate trg_payments_kind without charge_id and restore payments_kind_guard;
-- alter table payments drop column charge_id, restore two-way payments_one_link;
-- drop table payment_mandates, charges, billing_agreements, fee_plans;
-- drop types mandate_status, charge_status, agreement_status, fee_schedule,
-- fee_plan_scope, charge_kind; delete the six seeded fee_plans rows and the
-- finance.* site_settings keys.
-- =============================================================================
