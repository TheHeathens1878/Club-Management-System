-- =============================================================================
-- A collection is claimed before it is charged (20260905110000)
-- =============================================================================
-- Codex review, 2026-09-05, findings 4 and 5 (both High):
--
--   4. "Collection retries can charge members twice. chargeStoredCard()
--      creates a fresh checkout on every attempt. A timeout after payment, or
--      overlapping billing runs, can produce another charge. Uniqueness per
--      checkout does not prevent this."
--   5. "Automatic collection ignores partial payments. The billing cron
--      collects the original charge amount. Partially paid charges remain
--      pending, so a £100 charge with £40 already paid can collect another
--      £100."
--
-- Both are true. The ledger's idempotency is per SumUp checkout
-- (`payments.sumup_checkout_id` unique), and a second checkout for the same
-- charge is a second checkout. Nothing recorded that a collection had been
-- STARTED, so nothing could notice that one had.
--
--
-- 1. THE TABLE
-- ---------------------------------------------------------------------------
-- `collection_attempts` is the record of every server-side attempt to take
-- a charge from a stored card. It is written BEFORE SumUp is asked for
-- anything, so a run that dies between "checkout created" and "payment
-- recorded" leaves a row behind that the next run finds and reconciles —
-- asking SumUp what became of THAT checkout (by id, or by the deterministic
-- reference if the id was never stored) rather than starting another.
--
-- The claim is the unique index on (charge_id, attempt_no): two runs that
-- both compute "next attempt = 3" collide on the insert, and the loser walks
-- away. The reference `charge:<id>:auto:<n>` is unique for the same reason
-- and is what SumUp is asked for when the id is missing.
--
-- Amount: the attempt carries the amount it set out to collect — the balance
-- outstanding at that moment, computed from the ledger (payments less
-- refunds) immediately before the claim. That is finding 5.
--
-- Statuses:
--   started    claimed; a checkout may or may not exist yet
--   paid       SumUp reports the checkout paid and the payment is recorded
--   failed     SumUp refused or the completion failed; the card was not charged
--   abandoned  a checkout that was never completed and is now too old to be
--              in flight; nobody will complete it, so it cannot charge anyone
--
-- Financial record: no hard delete, no truncate, like `charges`.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y — one new table, enabled,
-- one SELECT policy for finance (is_finance()); no writes for authenticated —
-- every row is written by the server (service_role) on the member's or the
-- treasurer's behalf. Data touched: none. Rollback: §3.
-- =============================================================================

create table public.collection_attempts (
  id                 uuid primary key default gen_random_uuid(),
  charge_id          uuid not null references public.charges (id) on delete restrict,
  attempt_no         integer not null check (attempt_no > 0),
  checkout_reference text not null,
  sumup_checkout_id  text,
  amount_pence       integer not null check (amount_pence > 0),
  status             text not null default 'started'
                     check (status in ('started', 'paid', 'failed', 'abandoned')),
  sumup_status       text,
  error              text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  constraint collection_attempts_one_per_no unique (charge_id, attempt_no),
  constraint collection_attempts_reference_unique unique (checkout_reference),
  constraint collection_attempts_finished_when_done
    check ((status = 'started') = (finished_at is null))
);

create index collection_attempts_open_idx
  on public.collection_attempts (charge_id) where status = 'started';
create index collection_attempts_checkout_idx
  on public.collection_attempts (sumup_checkout_id) where sumup_checkout_id is not null;

comment on table public.collection_attempts is
  'Every server-side attempt to collect a charge from a stored card, written before SumUp is asked for anything. The unique (charge_id, attempt_no) is the claim: a second run collides and walks away; a run that died mid-way leaves a started row the next run reconciles against SumUp instead of charging again.';

create trigger trg_collection_attempts_no_delete
  before delete on public.collection_attempts
  for each row execute function public.deny_hard_delete();
create trigger trg_collection_attempts_no_truncate
  before truncate on public.collection_attempts
  for each statement execute function public.deny_truncate();

-- ---------------------------------------------------------------------------
-- 2. RLS AND GRANTS
-- ---------------------------------------------------------------------------
alter table public.collection_attempts enable row level security;

-- The treasurer can see what the machine tried and why it stopped.
create policy "collection_attempts_finance_read" on public.collection_attempts
  for select to authenticated
  using (public.is_finance());

revoke all privileges on table public.collection_attempts from public, anon;
grant select on table public.collection_attempts to authenticated;
grant select, insert, update on table public.collection_attempts to service_role;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 3. ROLLBACK
-- ---------------------------------------------------------------------------
--   drop table public.collection_attempts;
-- and restore the pre-20260905 chargeStoredCard() callers in apps/web, which
-- would reopen findings 4 and 5.
