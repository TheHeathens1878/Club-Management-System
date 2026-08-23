-- =============================================================================
-- P4.1 — subscription plans, subscriptions, the payments ledger, Stripe events
-- =============================================================================
-- PLAN.md task P4.1 ("Subs & payments: Stripe products/subscriptions per
-- season/team pricing; webhook Edge Function; payments ledger"; acceptance:
-- "Test-mode subscription lifecycle covered by tests; arrears view per team for
-- coaches"). Linear TH1-28.
--
-- SHAPE
--   * `subscription_plans` — what the club sells: per season, optionally per
--     team (NULL = club-wide), `amount_pence`, `billing` (one_off | monthly |
--     annual), `instalments` (for monthly: how many), Stripe product/price ids
--     once P4.1's Edge Function has created them, `active`.
--   * `subscriptions` — a person (the player, possibly a minor) on a plan,
--     paid for by `payer_person_id` (an adult: the player themself or an
--     active guardian — guarded), `status` (pending | active | past_due |
--     cancelled | completed), Stripe customer/subscription/checkout ids,
--     `started_at`/`ended_at`, `amount_due_pence` (snapshot of the plan at
--     sign-up, so a later price change does not rewrite history).
--   * `payments` (P1.5) generalised into the ledger P1.5 promised:
--     `booking_id` becomes nullable; `subscription_id` added; `kind`
--     (hire | subscription | other) derived by trigger from which link is
--     set; `stripe_*` ids; `refunded_pence`; CHECK that at most one of
--     booking/subscription is set. Existing rows are untouched (kind = hire).
--     A subscription payment with no matching `stripe_payment_intent_id`
--     twice cannot happen: partial unique on it.
--   * `stripe_events` — every webhook delivery by Stripe event id, so the
--     Edge Function is idempotent: insert first (`on conflict do nothing`),
--     process only if the insert happened, stamp `processed_at`.
--   * `subscription_arrears` (security_invoker view) — per subscription:
--     due, paid, outstanding, days overdue, team, season. A coach sees their
--     teams' rows through the underlying RLS; `club_admin` all.
--
-- RLS
--   plans: authenticated read active plans; club_admin write.
--   subscriptions: self (player or payer) read; guardian of a minor player
--     read; team staff read their team's (arrears view); club_admin +
--     service_role write; a person may INSERT their own / their child's
--     subscription in `pending` (the sign-up), nothing else.
--   payments: P1.5's staff/booker policies kept; plus payer/subject read of
--     subscription payments; team staff read their team's.
--   stripe_events: service_role only (no policy for authenticated).
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y; data touched: `payments`
-- existing rows get `kind = 'hire'` (9 prod rows); rollback: §9.
-- =============================================================================


-- =============================================================================
-- 1. ENUMS
-- =============================================================================

create type public.billing_kind as enum ('one_off', 'monthly', 'annual');
create type public.subscription_status as enum ('pending', 'active', 'past_due', 'cancelled', 'completed');
create type public.payment_kind as enum ('hire', 'subscription', 'other');


-- =============================================================================
-- 2. subscription_plans
-- =============================================================================

create table public.subscription_plans (
  id                 uuid primary key default gen_random_uuid(),
  season_id          uuid not null references public.seasons (id) on delete restrict,
  team_id            uuid references public.teams (id) on delete restrict,
  name               text not null,
  description        text,
  amount_pence       integer not null check (amount_pence > 0),
  billing            public.billing_kind not null default 'one_off',
  instalments        integer check (instalments is null or instalments between 1 and 12),
  stripe_product_id  text,
  stripe_price_id    text unique,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint subscription_plans_name_not_blank check (btrim(name) <> ''),
  constraint subscription_plans_instalments_monthly check (billing <> 'monthly' or instalments is not null)
);

create index subscription_plans_season_idx on public.subscription_plans (season_id, team_id) where active;

create trigger trg_subscription_plans_updated
  before update on public.subscription_plans
  for each row execute function public.set_updated_at();

comment on table public.subscription_plans is 'What the club charges for a season, club-wide or per team. Stripe ids filled in by the P4.1 Edge Function.';


-- =============================================================================
-- 3. subscriptions
-- =============================================================================

create table public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  plan_id                  uuid not null references public.subscription_plans (id) on delete restrict,
  person_id                uuid not null references public.people (id) on delete restrict,
  payer_person_id          uuid not null references public.people (id) on delete restrict,
  status                   public.subscription_status not null default 'pending',
  amount_due_pence         integer not null default 0 check (amount_due_pence >= 0),
  stripe_customer_id       text,
  stripe_subscription_id   text unique,
  stripe_checkout_session_id text unique,
  started_at               timestamptz,
  ended_at                 timestamptz,
  cancel_reason            text,
  created_by               uuid references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint subscriptions_ended_after_started check (ended_at is null or started_at is null or ended_at >= started_at)
);

create unique index subscriptions_live_idx on public.subscriptions (plan_id, person_id)
  where status in ('pending', 'active', 'past_due');
create index subscriptions_person_idx on public.subscriptions (person_id);
create index subscriptions_payer_idx  on public.subscriptions (payer_person_id);

create trigger trg_subscriptions_updated
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create or replace function public.subscriptions_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_admin boolean := public.is_club_admin();
  v_caller uuid := public.current_person_id();
  v_payer_dob date;
begin
  if tg_op = 'INSERT' then
    -- The payer is an adult with a known dob: the player themself, or an active guardian of a minor player.
    select dob into v_payer_dob from public.people where id = new.payer_person_id;
    if v_payer_dob is null or public.is_minor_dob(v_payer_dob) then
      raise exception 'subscriptions: the payer must be an adult with a known date of birth' using errcode = 'P0001';
    end if;
    if new.payer_person_id <> new.person_id
       and not exists (select 1 from public.guardianships g
                       where g.child_person_id = new.person_id and g.guardian_person_id = new.payer_person_id and g.ended_at is null)
    then
      raise exception 'subscriptions: the payer must be the player or an active guardian of the player [SAFEGUARDING.md SG-4]'
        using errcode = 'P0001';
    end if;
    if auth.uid() is not null and not v_admin then
      if new.payer_person_id is distinct from v_caller then
        raise exception 'subscriptions: you can only sign up yourself or your child' using errcode = 'P0001';
      end if;
      if new.status <> 'pending' then
        raise exception 'subscriptions: a sign-up starts as pending' using errcode = 'P0001';
      end if;
    end if;
    if coalesce(new.amount_due_pence, 0) = 0 then
      select amount_pence into new.amount_due_pence from public.subscription_plans where id = new.plan_id;
    end if;
    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;

  -- UPDATE: identity immutable; status changes are admin/service_role only.
  if new.plan_id <> old.plan_id or new.person_id <> old.person_id or new.payer_person_id <> old.payer_person_id then
    raise exception 'subscriptions: plan, player and payer are immutable — cancel and create a new subscription' using errcode = 'P0001';
  end if;
  if auth.uid() is not null and not v_admin then
    if new.status <> old.status and not (new.status = 'cancelled' and old.status = 'pending' and old.payer_person_id = v_caller) then
      raise exception 'subscriptions: only a club_admin (or Stripe) changes a subscription''s status' using errcode = 'P0001';
    end if;
  end if;
  if new.status in ('cancelled', 'completed') and new.ended_at is null then
    new.ended_at := now();
  end if;
  if new.status = 'active' and new.started_at is null then
    new.started_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_subscriptions_guard
  before insert or update on public.subscriptions
  for each row execute function public.subscriptions_guard();

comment on table public.subscriptions is 'A player on a plan, paid for by an adult (self or active guardian). Status driven by Stripe via the webhook Edge Function or by a club_admin.';


-- =============================================================================
-- 4. payments → the ledger
-- =============================================================================

alter table public.payments
  alter column booking_id drop not null,
  add column subscription_id uuid references public.subscriptions (id) on delete restrict,
  add column kind public.payment_kind not null default 'hire',
  add column stripe_charge_id text,
  add column stripe_invoice_id text,
  add column refunded_pence integer not null default 0 check (refunded_pence >= 0),
  add column refunded_at timestamptz,
  add constraint payments_one_link check (not (booking_id is not null and subscription_id is not null)),
  add constraint payments_refund_within_amount check (refunded_pence <= amount_pence);

create index payments_subscription_idx on public.payments (subscription_id) where subscription_id is not null;
create unique index payments_stripe_payment_intent_idx on public.payments (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

create or replace function public.payments_kind_guard()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  new.kind := case when new.booking_id is not null then 'hire'
                   when new.subscription_id is not null then 'subscription'
                   else 'other' end;
  return new;
end;
$$;

create trigger trg_payments_kind
  before insert or update of booking_id, subscription_id on public.payments
  for each row execute function public.payments_kind_guard();

comment on column public.payments.kind is 'Derived from which link is set: hire (booking), subscription, or other.';


-- =============================================================================
-- 5. stripe_events
-- =============================================================================

create table public.stripe_events (
  id            text primary key,
  type          text not null,
  livemode      boolean not null default false,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text,
  payload       jsonb not null
);

create index stripe_events_unprocessed_idx on public.stripe_events (received_at) where processed_at is null;

alter table public.stripe_events enable row level security;
revoke all privileges on public.stripe_events from anon, authenticated, service_role;
grant select, insert, update on public.stripe_events to service_role;

comment on table public.stripe_events is 'Every Stripe webhook delivery by event id — the idempotency record for the webhook Edge Function. service_role only.';


-- =============================================================================
-- 6. arrears
-- =============================================================================

-- A name the caller is entitled to see: their own, a child they guard, a
-- member of a team they staff, or anyone for club_admin / safeguarding_lead.
-- Lets security_invoker views carry a name without granting people reads.
create or replace function public.display_name(p_person_id uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
    when public.can_act_for(p_person_id)
      or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[])
      or exists (select 1 from public.team_memberships m
                 where m.person_id = p_person_id and m.left_at is null and public.is_team_staff(m.team_id))
    then (select first_name || ' ' || last_name from public.people where id = p_person_id)
    else null end;
$$;
revoke all privileges on function public.display_name(uuid) from public, anon;
grant execute on function public.display_name(uuid) to authenticated, service_role;

create or replace view public.subscription_arrears
  with (security_invoker = true) as
  select s.id as subscription_id, s.person_id, public.display_name(s.person_id) as person_name,
         s.payer_person_id, s.plan_id, pl.name as plan_name, pl.season_id, pl.team_id, t.name as team_name,
         s.status, s.amount_due_pence,
         coalesce(sum(py.amount_pence - py.refunded_pence), 0)::integer as paid_pence,
         (s.amount_due_pence - coalesce(sum(py.amount_pence - py.refunded_pence), 0))::integer as outstanding_pence,
         s.started_at, s.created_at,
         greatest(0, (current_date - coalesce(s.started_at, s.created_at)::date))::integer as days_since_start
  from public.subscriptions s
  join public.subscription_plans pl on pl.id = s.plan_id
  left join public.teams t on t.id = pl.team_id
  left join public.payments py on py.subscription_id = s.id
  where s.status in ('active', 'past_due', 'pending')
  group by s.id, pl.id, t.name;

comment on view public.subscription_arrears is 'Live subscriptions with paid/outstanding totals. Rows visible per the underlying RLS (coach: own teams; admin: all).';


-- =============================================================================
-- 7. ROW LEVEL SECURITY
-- =============================================================================

alter table public.subscription_plans enable row level security;
alter table public.subscriptions      enable row level security;

create policy "subscription_plans_read" on public.subscription_plans for select to authenticated using (active or public.is_club_admin());
create policy "subscription_plans_admin_write" on public.subscription_plans for all to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());

create policy "subscriptions_self_read" on public.subscriptions for select to authenticated
  using (person_id = public.current_person_id() or payer_person_id = public.current_person_id()
         or public.is_active_guardian_of(person_id));
create policy "subscriptions_staff_read" on public.subscriptions for select to authenticated
  using (exists (select 1 from public.subscription_plans pl where pl.id = subscriptions.plan_id and pl.team_id is not null
                 and public.is_team_staff(pl.team_id)));
create policy "subscriptions_admin_read" on public.subscriptions for select to authenticated
  using (public.is_club_admin());
create policy "subscriptions_self_insert" on public.subscriptions for insert to authenticated
  with check (payer_person_id = public.current_person_id() or public.is_club_admin());
create policy "subscriptions_self_cancel" on public.subscriptions for update to authenticated
  using (payer_person_id = public.current_person_id())
  with check (payer_person_id = public.current_person_id() and status = 'cancelled');
create policy "subscriptions_admin_update" on public.subscriptions for update to authenticated
  using (public.is_club_admin()) with check (public.is_club_admin());

-- payments: the subject/payer of a subscription sees its payments; team staff see their team's.
create policy "payments_subscription_read" on public.payments for select to authenticated
  using (subscription_id is not null and exists (
    select 1 from public.subscriptions s
    join public.subscription_plans pl on pl.id = s.plan_id
    where s.id = payments.subscription_id
      and (s.person_id = public.current_person_id() or s.payer_person_id = public.current_person_id()
           or public.is_active_guardian_of(s.person_id)
           or (pl.team_id is not null and public.is_team_staff(pl.team_id)))));


-- =============================================================================
-- 8. GRANTS
-- =============================================================================

revoke all privileges on public.subscription_plans, public.subscriptions from anon, authenticated, service_role;
grant select, insert, update, delete on public.subscription_plans to authenticated, service_role;
grant select, insert, update on public.subscriptions to authenticated, service_role;
grant select on public.subscription_arrears to authenticated, service_role;
revoke all privileges on function public.subscriptions_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.payments_kind_guard()  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 9. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop view subscription_arrears; drop table stripe_events; alter table payments
-- drop constraint payments_one_link, payments_refund_within_amount, drop column
-- subscription_id, kind, stripe_charge_id, stripe_invoice_id, refunded_pence,
-- refunded_at, alter column booking_id set not null (only valid while no
-- subscription payments exist); drop table subscriptions, subscription_plans;
-- drop the two trigger functions; drop the three types.
