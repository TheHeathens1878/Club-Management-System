-- =============================================================================
-- Web push: the browser's subscription, kept in push_tokens
-- =============================================================================
-- Adam, 2026-09-01: "ask the user to create the app as a web app with
-- notifications enabled". The portal is used on phones through Safari and
-- Chrome, and on iOS a web push subscription only exists once the site is on
-- the Home Screen — so the install and the permission are one flow, and the
-- thing that flow produces is a `PushSubscription`, not an Expo token.
--
-- WHY NOT A SECOND TABLE
--   `push_subscriptions` was the imported function-room app's name for this
--   and it has never existed here (it is listed as a phantom in
--   `apps/web/src/lib/supabase/legacy.ts`). Adding it now would give the club
--   two device registers with two sets of policies, two pruning rules and two
--   places to forget when somebody leaves. `push_tokens` already IS the device
--   register: one row per device, the token as the primary key so a
--   re-registered handset moves owner instead of pushing one member's messages
--   to another member's lock screen. A browser is a device. It goes here.
--
-- THE SHAPE OF A WEB ROW
--   * `platform = 'web'`
--   * `token`   = the subscription's **endpoint**, which is exactly what an
--     Expo token is for an app: the opaque address the push service routes on,
--     and the thing a 404/410 tells us is dead. Making it the primary key is
--     what lets `comms-dispatch` prune a gone endpoint with the same
--     delete-by-token it already does for Expo.
--   * `web_subscription` = the whole `PushSubscription` JSON, because the
--     endpoint alone cannot be encrypted to: RFC 8291 needs `keys.p256dh` (the
--     browser's public key) and `keys.auth` (its 16-byte secret).
--
--   A CHECK ties the three together in both directions: a 'web' row must carry
--   a well-formed subscription whose endpoint IS the token, and every other
--   platform must carry none. The two kinds of token then cannot be confused —
--   the dispatcher decides which sender to use from `platform` and the
--   database guarantees the row matches. Without it, an Expo token with a
--   stray `web_subscription`, or a 'web' row with no keys, would be a runtime
--   crash in a scheduled job rather than a rejected insert.
--
-- RLS — NO NEW POLICY IS NEEDED, AND THAT IS DELIBERATE
--   `push_tokens_self_all` (20260823240000) is `for all ... using
--   can_act_for(person_id) with check can_act_for(person_id)`. Policies are
--   row-scoped, not column-scoped, so a new column on an existing table is
--   already covered by every policy on that table: nobody can read, write or
--   delete a `web_subscription` they could not already read, write or delete
--   the row of. The grants are table-level for the same reason — `authenticated`
--   keeps select/insert/update/delete, `service_role` keeps select/delete.
--   Adding a policy here would not tighten anything; it would only create a
--   second rule to keep in step with the first.
--
--   The one thing worth saying out loud: the browser writes this row itself,
--   with the user-scoped client, and `can_act_for()` is the whole gate. There
--   is no API route in front of it and there does not need to be one.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy added, dropped or
-- altered — one column and one CHECK on a table whose policies already cover
-- it); data touched: none (every existing row is Expo, and the constraint is
-- satisfied by `web_subscription is null`); rollback: §4.
-- =============================================================================


-- =============================================================================
-- 1. COLUMN
-- =============================================================================

alter table public.push_tokens
  add column if not exists web_subscription jsonb;

comment on column public.push_tokens.web_subscription is
  'The browser''s full PushSubscription JSON (endpoint + keys.p256dh + keys.auth) for platform = ''web''; null for every native token. RFC 8291 encryption needs the keys, so the endpoint alone is not enough to deliver.';


-- =============================================================================
-- 2. THE CONSTRAINT THAT KEEPS THE TWO KINDS APART
-- =============================================================================

alter table public.push_tokens
  add constraint push_tokens_web_subscription_shape check (
    case
      when platform = 'web' then
        web_subscription is not null
        and jsonb_typeof(web_subscription) = 'object'
        and web_subscription ->> 'endpoint' = token
        and coalesce(btrim(web_subscription #>> '{keys,p256dh}'), '') <> ''
        and coalesce(btrim(web_subscription #>> '{keys,auth}'), '') <> ''
      else
        web_subscription is null
    end
  );

-- A push endpoint is a URL, and the PK's btree index has a size limit an
-- unbounded one could reach. Real endpoints are 100–300 characters; 2000 is
-- generous headroom that still fails the insert rather than the index build.
alter table public.push_tokens
  add constraint push_tokens_token_length check (length(token) <= 2000);

comment on table public.push_tokens is
  'The club''s device register: one row per device that can receive a push. Native app installs hold an Expo token; browsers on the Home Screen hold a Web Push subscription (platform = ''web'', token = endpoint, web_subscription = the keys). Written by the app or the browser under the member''s own RLS; read by the comms-dispatch Edge Function. Token is the PK so a re-registered device moves owner instead of duplicating.';


-- =============================================================================
-- 3. SCHEMA CACHE
-- =============================================================================

notify pgrst, 'reload schema';


-- =============================================================================
-- 4. ROLLBACK (documented, not executed)
-- =============================================================================
-- alter table public.push_tokens drop constraint push_tokens_token_length;
-- alter table public.push_tokens drop constraint push_tokens_web_subscription_shape;
-- alter table public.push_tokens drop column web_subscription;
-- delete from public.push_tokens where platform = 'web';   -- endpoints, now undeliverable


-- =============================================================================
-- 5. TESTS: supabase/tests/web_push_subscriptions.test.sql
-- =============================================================================
