-- =============================================================================
-- P5.5 — push_tokens: the device register the push fan-out delivers to
-- =============================================================================
-- PLAN.md task P5.5 ("Push fan-out: DB webhook → Edge Function → Expo push API
-- for offline participants; respects preferences (P4.4)"). The Edge Functions
-- `push-fanout` (which enqueues) and `comms-dispatch` (which delivers) both
-- exist; this is the one table they were missing.
--
-- SHAPE
--   One row per device token. The **token** is the primary key, not
--   (person, token): an Expo token identifies a device installation, and if a
--   phone is handed to somebody else the app's upsert should move the row to
--   the new person rather than leave a stale duplicate that pushes one
--   member's messages to another member's lock screen. That is a safeguarding
--   property, not a tidiness one.
--
-- RLS
--   Self (and a guardian acting for a minor) manages their own devices via
--   `can_act_for()` — the same gate as `comms_preferences`. There is no admin
--   read policy: a device token is not something a committee member needs, and
--   `outbound_messages` already records what was sent to whom.
--   `service_role` reads them (to fan out) and deletes them (Expo replies
--   `DeviceNotRegistered` for a token that is dead; keeping it would waste
--   every future push and, worse, keep a name attached to a dead handset).
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one new table); data
-- touched: none; rollback: §5.
-- =============================================================================


-- =============================================================================
-- 1. TABLE
-- =============================================================================

create table public.push_tokens (
  token       text primary key,
  person_id   uuid not null references public.people (id) on delete cascade,
  platform    text not null default 'unknown',
  device_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint push_tokens_token_not_blank check (btrim(token) <> ''),
  constraint push_tokens_platform_known check (platform in ('ios', 'android', 'web', 'unknown'))
);

create index push_tokens_person_idx on public.push_tokens (person_id);

create trigger trg_push_tokens_updated
  before update on public.push_tokens
  for each row execute function public.set_updated_at();

comment on table public.push_tokens is
  'Expo push tokens by device. Written by the app on sign-in; read by the comms-dispatch Edge Function. Token is the PK so a re-registered device moves owner instead of duplicating.';
comment on column public.push_tokens.platform is
  'ios | android | web | unknown — informational; Expo routes by the token itself.';


-- =============================================================================
-- 2. ROW LEVEL SECURITY
-- =============================================================================

alter table public.push_tokens enable row level security;

-- Self, or a guardian acting for a minor child — the comms_preferences gate.
create policy "push_tokens_self_all" on public.push_tokens for all to authenticated
  using (public.can_act_for(person_id))
  with check (public.can_act_for(person_id));


-- =============================================================================
-- 3. GRANTS
-- =============================================================================

revoke all privileges on public.push_tokens from anon, authenticated, service_role;
grant select, insert, update, delete on public.push_tokens to authenticated;
-- The dispatcher reads tokens to send, and deletes the ones Expo reports dead.
grant select, delete on public.push_tokens to service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 4. TESTS (to write alongside: supabase/tests/push_tokens.test.sql)
-- =============================================================================
-- * a member registers a token for themselves and reads it back
-- * a member cannot read or delete another member's token
-- * a guardian registers a token for their minor child; a non-guardian cannot
-- * anon gets nothing (no policy, no grant)
-- * re-registering an existing token under a different person moves the row


-- =============================================================================
-- 5. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop table public.push_tokens;
