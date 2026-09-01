-- =============================================================================
-- Super-user purge — one narrow, audited door through SG-2 (20260825380000)
-- =============================================================================
-- Adam (club owner, the sole `profiles.role = 'super_user'`), 2026-08-25:
-- "allow super users to hard delete users and messages." The two reasons are
-- a UK GDPR Article 17 erasure request the club must be able to honour, and
-- clearing out test accounts and mistakes the club made itself.
--
-- WHAT THIS IS AN EXCEPTION TO, quoted so the exception is judged against the
-- words it bends and not against a summary of them:
--
--   SG-2 — "No row in `messages`, `audit_log`, `safeguarding_concerns`, or
--   `conversation_participants` may ever be hard-deleted, by any role,
--   including `service_role`. Deletion is expressed as `deleted_at`/
--   `deleted_by`; the row and its metadata survive."
--
--   SG-2, on the retention job, which is the sentence this migration builds
--   on — "It runs as a dedicated role, and if that role ever needs to bypass
--   `deny_hard_delete()` it must do so via an explicitly named, audit-logged
--   function — not by disabling the trigger."
--
--   SG-7 — "Every read, write, export or search of safeguarding data writes a
--   row to `public.audit_log`." And: `detail` carries "changed fields, **never**
--   the narrative text".
--
--   SG-8 — "Legal hold beats retention, always. A `legal_hold` flag on a
--   conversation, person, or media item causes the retention job to skip it
--   and log the skip." Also: "Cannot pseudonymise anyone named in an open
--   concern" — the same sentence, read as the floor for destruction too.
--
-- THE SHAPE OF THE EXCEPTION
--
--   1. The triggers are NOT weakened in general and NOT disabled anywhere.
--      `deny_hard_delete()` gains exactly one condition: a transaction-local
--      ticket, which is the id of an `audit_log` row written in the SAME
--      transaction with action `messages.purged` or `people.purged`. No audit
--      row, no delete. The audit row is therefore not a side effect of the
--      purge; it is the thing that authorises it.
--   2. The ticket only opens NINE tables, named in a literal allowlist inside
--      the trigger function: people, person_roles, guardian_consents,
--      certifications, certification_exemptions, identity_documents, messages,
--      message_attachments, conversation_participants. `audit_log`,
--      `safeguarding_concerns`, `safeguarding_concern_notes` and `media_items`
--      keep the unconditional guard they have today — a purge can never reach
--      them, so the trail and the evidence outlive the purge by construction.
--   3. `deny_truncate()` is untouched. Nothing here truncates, drops or
--      disables a trigger, so SG-2's process rule holds unchanged.
--   4. The privilege layer is untouched: DELETE stays revoked from `anon`,
--      `authenticated` and `service_role` on all nine tables. The ticket is
--      only meaningful inside a SECURITY DEFINER function owned by the table
--      owner — i.e. inside the two functions below — because every other
--      caller is stopped by the missing privilege before the trigger is
--      reached. Setting the GUC by hand from a client buys nothing.
--   5. Evidence is not the owner's to destroy. Both functions refuse, by name,
--      anything under a legal hold or attached to a safeguarding concern.
--
-- SG-3 note: the refusal checks read `safeguarding_concerns`, which has FORCE
-- RLS, from a SECURITY DEFINER function owned by the table owner — the same
-- pattern `read_concerns()` and `my_concern_receipts()` already use, and the
-- reason the check cannot be fooled by a concern that names the caller (which
-- `concern_names_caller` hides from the caller's own reads). The functions
-- never return concern content; they say only that one exists.
--
-- TABLES THE PERSON PURGE TOUCHES, and how (the full FK graph of
-- `public.people`, enumerated from pg_constraint / information_schema while
-- writing this, not from memory):
--
--   DELETED explicitly, children first (all `on delete restrict`, so the
--   database would refuse the person delete until these are gone):
--     referee_match_posts, message_mentions, message_reactions,
--     message_attachments, messages, conversation_participants, board_replies,
--     board_posts, fixture_player_stats, emergency_contacts,
--     identity_documents, certification_exemptions, certifications,
--     guardian_consents, guardianships, person_roles, team_memberships,
--     registrations, subscriptions, memberships, profiles
--
--   DELETED by cascade when the `people` row (or their `profiles` row) goes
--   (`on delete cascade`), counted before the delete so the summary is honest:
--     account_requests, availability, board_reads, booking_attendance,
--     booking_availability, comms_preferences, event_responses,
--     fixture_lineup_slots, media_subjects, membership_people,
--     neon_import_pending, person_registration_details, push_tokens,
--     selections, staff_away, team_membership_leave_requests,
--     waiting_list_access
--
--   NULLED, not deleted — these rows are somebody else's record, or the
--   club's, that merely names this person:
--     payments.subscription_id — nulled BY HAND before the subscriptions go,
--       because that FK is `restrict`. A payment is the club's financial
--       ledger; erasure of a member does not erase the club's books.
--     bookings.booker_person_id, bookings.booker_profile_id,
--     conversations.created_by_person_id, outbound_messages.person_id,
--     referee_match_posts.claimed_by_person_id,
--     team_membership_leave_requests.requested_by_person_id,
--     waiting_list_notes.author_person_id  (all `on delete set null`)
--     Every `*_by` / `created_by` / `verified_by` column across the schema
--       references `auth.users` `on delete set null`, so deleting the login —
--       which the web layer does after this function returns — nulls the
--       actor on staff records (holiday_requests, timesheets, sickness_records
--       and the rest) while the rows themselves stay.
--
--   NEVER TOUCHED:
--     audit_log — including every row about this person and the purge itself.
--       `audit_log.actor_id` is `references auth.users on delete set null`, so
--       deleting the login (done by the web layer, after this function
--       returns) nulls the actor id on the person's OWN historic rows while
--       `actor_email`, action, entity and detail survive. The purge's audit
--       row is written by the super user, so it is not affected at all.
--     safeguarding_concerns, safeguarding_concern_notes — a person named by
--       either is refused outright, so the question never arises.
--     media_items — a photo is the club's record; only the person's SUBJECT
--       TAGS (media_subjects) go, by cascade.
--     waiting_list_entries — free text (parent_name, parent_email), no FK to
--       people. A waiting-list application is the applicant's record, not a
--       club member's row, and is cleared through the waiting list.
--
--   TWO SIDE EFFECTS THE PURGE HANDLES ITSELF:
--     * SG-1.7 — removing a participant by DELETE fires no guard (SG-1 is
--       enforced on INSERT and on `left_at`), so a purge could leave one adult
--       alone with one minor. After the participant rows go, the function
--       closes any open conversation the person was in that
--       `conversation_is_compliant()` now calls non-compliant. That is exactly
--       what SG-1.8's refusal tells an administrator to do ("close them
--       first"). The count comes back as `conversations_closed`.
--     * SG-1.8 — `guardianships` carries a BEFORE DELETE guard that refuses to
--       remove a link that would leave an adult alone with a minor. The order
--       below deletes `conversation_participants` BEFORE `guardianships` for
--       that reason: by the time the link goes, the purged person is in no
--       open room, so the guard has nothing to object to and is never bypassed.
--
--   KNOWN CONSEQUENCES, deliberate and documented rather than hidden:
--     * `board_replies.post_id` cascades from `board_posts`, so deleting the
--       person's noticeboard posts also removes other people's replies to
--       them. The summary counts those separately
--       (`board_replies_on_their_posts`) so the screen can say so.
--     * `guardian_consents` rows where this person is the GUARDIAN are deleted
--       with them, and those rows are about a child who remains. A consent is
--       a statement by one named guardian about one named child; with the
--       guardian's record gone the statement has no author left, so it goes
--       too. The `guardian_consents` audit rows (`safeguarding.consent.*`)
--       stay, as does the child's own record.
--     * `membership_people` rows for the other members of a family membership
--       cascade when the primary person's `memberships` row goes. Their
--       `people` rows, registrations and team memberships are untouched.
--   Two references that would have destroyed somebody else's record outright
--   are REFUSED instead, because their columns are `not null` and there is
--   nothing to null: a subscription this person merely PAYS FOR on another
--   person's behalf, and an SG-6 certification exemption they GRANTED to
--   another person.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy is added, changed
-- or relaxed; the DELETE/TRUNCATE revokes stand); data touched: none by this
-- migration — the functions it installs destroy member data when a super user
-- calls them; rollback: end of file.
-- =============================================================================


-- =============================================================================
-- 1. is_super_user()
-- =============================================================================
-- There was no database-side notion of a super user before this: the web app
-- reads `profiles.role` in `isSuperUser()` (apps/web/src/lib/auth.ts) and the
-- database only knew `is_committee()`, which is TRUE for committee members
-- too. A door this size cannot be gated on a check the client makes, and it
-- cannot be gated on `is_committee()`.

create or replace function public.is_super_user()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    (select p.role = 'super_user'::public.user_role
       from public.profiles p
      where p.id = (select auth.uid())),
    false);
$$;

revoke all privileges on function public.is_super_user() from public, anon;
grant execute on function public.is_super_user() to authenticated, service_role;

comment on function public.is_super_user() is
  'True when the caller''s profiles.role is super_user. The gate on purge_message() and purge_person(); false for service_role and every unauthenticated path, which have no auth.uid().';


-- =============================================================================
-- 2. deny_hard_delete() — the same refusal, plus one ticketed door
-- =============================================================================
-- Unchanged in every respect except the `if` below. The message, the errcode
-- (P0001, raised without an explicit `using errcode`, exactly as before) and
-- the behaviour for every other caller are byte-for-byte what they were, which
-- is why the existing SG-2 tests still pass untouched.
--
-- The ticket cannot be minted by the client roles that could plausibly hold
-- one: DELETE is revoked from anon, authenticated and service_role on all nine
-- tables, and none of them has a FOR DELETE policy, so a forged GUC gets a
-- caller precisely nowhere. The audit-row requirement is the second lock and
-- the useful one: it makes "something was destroyed here, by this person, for
-- this reason" a precondition of destroying it, not a promise to write it
-- afterwards.

create or replace function public.deny_hard_delete()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $function$
declare
  v_ticket text := coalesce(current_setting('app.purge_ticket', true), '');
begin
  -- Two nested ifs, not one condition with an `and`: SQL does not promise to
  -- evaluate the parts of an AND left to right, and `v_ticket::bigint` must
  -- never be reached with the empty string every ordinary caller carries.
  if v_ticket ~ '^[0-9]+$'
     and tg_table_name in (
           'people', 'person_roles', 'guardian_consents', 'certifications',
           'certification_exemptions', 'identity_documents',
           'messages', 'message_attachments', 'conversation_participants')
  then
    if exists (
      select 1 from public.audit_log a
       where a.id = v_ticket::bigint
         and a.action in ('messages.purged', 'people.purged')
         and a.created_at = now())
    then
      -- A super-user purge, with its audit row already written in this
      -- transaction. audit_log, safeguarding_concerns,
      -- safeguarding_concern_notes and media_items are absent from the list
      -- above and stay absolute.
      return old;
    end if;
  end if;

  raise exception
    'hard delete is not permitted on %.% (row id %): set deleted_at instead (SAFEGUARDING.md SG-2)',
    tg_table_schema,
    tg_table_name,
    coalesce(to_jsonb(old) ->> 'id', '<unknown>');
  return null;
end $function$;

comment on function public.deny_hard_delete() is
  'SG-2 delete guard. Refuses every hard delete except one: a super-user purge holding a transaction-local ticket that is the id of the audit_log row recording it, and only on the nine tables named in the function body. audit_log, safeguarding_concerns, safeguarding_concern_notes and media_items are never openable.';


-- =============================================================================
-- 3. purge_message(message_id, reason)
-- =============================================================================
-- REFUSES (P0001, saying which):
--   * the message is cited by a safeguarding concern or a concern note — the
--     citation is the `[message:<id> conversation:<id>]` prefix `report_message()`
--     writes into the narrative, so this is the same string the retention job
--     looks for. Evidence is not the owner's to destroy (SG-8).
--   * the conversation is under `conversations.legal_hold`.
--   * the author is under `people.legal_hold`.
--   * a concern under `safeguarding_concerns.legal_hold` cites the conversation
--     or names the author.
-- REFUSES (42501): anyone who is not a super user.
-- The audit row names the conversation, the message, the actor and the reason,
-- and NEVER the body — SG-7's rule about `detail`, applied to a destruction
-- rather than a read.

create or replace function public.purge_message(p_message_id uuid, p_reason text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  m         public.messages%rowtype;
  v_hold    boolean;
  v_ticket  bigint;
  v_files   integer;
  v_reacts  integer;
  v_mentions integer;
  v_cards   integer;
begin
  if not public.is_super_user() then
    raise exception 'Only a super user may permanently delete a message. Everyone else deletes a message by leaving a tombstone, which is what SAFEGUARDING.md SG-2 requires.'
      using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'purge_message: a reason is required — it is the only thing the audit row can say about what was destroyed.'
      using errcode = '22023';
  end if;

  select * into m from public.messages where id = p_message_id;
  if not found then
    raise exception 'purge_message: unknown message %', p_message_id using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.safeguarding_concerns c
     where c.deleted_at is null
       and c.narrative like '%message:' || m.id::text || '%')
  then
    raise exception 'purge_message: this message is cited by a safeguarding concern. It is evidence, and it stays [SAFEGUARDING.md SG-8].'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.safeguarding_concern_notes n
     where n.deleted_at is null
       and n.body like '%message:' || m.id::text || '%')
  then
    raise exception 'purge_message: this message is cited in a note on a safeguarding concern. It is evidence, and it stays [SAFEGUARDING.md SG-8].'
      using errcode = 'P0001';
  end if;

  select c.legal_hold into v_hold from public.conversations c where c.id = m.conversation_id;
  if coalesce(v_hold, false) then
    raise exception 'purge_message: this conversation is under a legal hold. A legal hold beats everything, including the club owner [SAFEGUARDING.md SG-8].'
      using errcode = 'P0001';
  end if;

  select p.legal_hold into v_hold from public.people p where p.id = m.sender_person_id;
  if coalesce(v_hold, false) then
    raise exception 'purge_message: the person who sent this message is under a legal hold [SAFEGUARDING.md SG-8].'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.safeguarding_concerns c
     where c.legal_hold
       and (c.narrative like '%conversation:' || m.conversation_id::text || '%'
            or c.subject_person_id = m.sender_person_id
            or c.reported_person_id = m.sender_person_id
            or c.reported_by_person_id = m.sender_person_id))
  then
    raise exception 'purge_message: a safeguarding concern under a legal hold covers this conversation or its author [SAFEGUARDING.md SG-8].'
      using errcode = 'P0001';
  end if;

  select count(*) into v_files    from public.message_attachments where message_id = m.id;
  select count(*) into v_reacts   from public.message_reactions   where message_id = m.id;
  select count(*) into v_mentions from public.message_mentions    where message_id = m.id;
  select count(*) into v_cards    from public.referee_match_posts where message_id = m.id;

  -- The audit row comes FIRST, and its id is the ticket the delete guard asks
  -- for. Nothing below can run without it, and it carries no body.
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(),
          (select u.email from auth.users u where u.id = auth.uid()),
          'messages.purged',
          'messages',
          m.id::text,
          jsonb_build_object(
            'conversation_id',   m.conversation_id,
            'sender_person_id',  m.sender_person_id,
            'sent_at',           m.created_at,
            'reason',            p_reason,
            'attachments',       v_files,
            'reactions',         v_reacts,
            'mentions',          v_mentions,
            'referee_cards',     v_cards,
            'was_soft_deleted',  m.deleted_at is not null,
            'was_redacted',      m.redacted_at is not null))
  returning id into v_ticket;

  perform set_config('app.purge_ticket', v_ticket::text, true);

  -- Children first. `message_mentions` cascades and `reply_to_id` /
  -- `conversation_participants.last_read_message_id` set themselves to NULL,
  -- but the rows that RESTRICT must go by name.
  delete from public.referee_match_posts where message_id = m.id;
  delete from public.message_mentions     where message_id = m.id;
  delete from public.message_reactions    where message_id = m.id;
  delete from public.message_attachments  where message_id = m.id;
  delete from public.messages             where id = m.id;

  -- Close the door behind us: the ticket is transaction-local anyway, but a
  -- caller who wraps several purges in one transaction should not have a
  -- second one riding on the first one's audit row.
  perform set_config('app.purge_ticket', '', true);
end;
$$;

revoke all privileges on function public.purge_message(uuid, text) from public, anon;
grant execute on function public.purge_message(uuid, text) to authenticated, service_role;

comment on function public.purge_message(uuid, text) is
  'Super user only (42501 otherwise): destroy one message and everything hanging off it, leaving an audit_log row (messages.purged) naming the conversation, the message, the actor and the reason but never the body. Refuses (P0001) a message cited by a safeguarding concern or a concern note, a conversation or author under a legal hold, and a message covered by a legal-held concern — evidence is not the owner''s to destroy [SAFEGUARDING.md SG-2, SG-7, SG-8].';


-- =============================================================================
-- 4. purge_person(person_id, reason)
-- =============================================================================
-- REFUSES (P0001, saying which):
--   * `people.legal_hold` is set.
--   * the person is the subject, the reported person, the reporter, or the
--     author of a note on any safeguarding concern — a purge would take the
--     concern's own FK targets with it.
--   * the person is a participant in, or has sent a message into, a
--     conversation under `conversations.legal_hold`.
--   * the person pays for somebody else's subscription, or granted somebody
--     else's certification exemption — both are the other person's record and
--     neither column can be nulled.
--   * the person is the caller. A super user cannot delete the account they
--     are holding the door open with.
-- REFUSES (42501): anyone who is not a super user.
-- Returns a jsonb summary — what was deleted, what was nulled, and the auth
-- user id the web layer must then remove — for the screen to show.

create or replace function public.purge_person(p_person_id uuid, p_reason text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_person   public.people%rowtype;
  v_me       uuid := public.current_person_id();
  v_auth_id  uuid;
  v_ticket   bigint;
  v_n        integer;
  v_closed   integer := 0;
  v_convs    uuid[];
  v_deleted  jsonb := '{}'::jsonb;
  v_cascaded jsonb;
  v_nulled   jsonb;
  v_name     text;
begin
  if not public.is_super_user() then
    raise exception 'Only a super user may permanently delete a person. Everyone else retires a record, which keeps it [SAFEGUARDING.md SG-2].'
      using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'purge_person: a reason is required — it is the only thing the audit row can say about what was destroyed.'
      using errcode = '22023';
  end if;

  select * into v_person from public.people where id = p_person_id;
  if not found then
    raise exception 'purge_person: unknown person %', p_person_id using errcode = 'P0001';
  end if;
  v_name := btrim(v_person.first_name || ' ' || v_person.last_name);

  if v_me is not null and v_me = p_person_id then
    raise exception 'purge_person: you cannot permanently delete yourself. Ask the other super user, or retire the record.'
      using errcode = 'P0001';
  end if;

  if v_person.legal_hold then
    raise exception 'purge_person: % is under a legal hold. A legal hold beats everything, including the club owner [SAFEGUARDING.md SG-8].', v_name
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.safeguarding_concerns c
     where c.subject_person_id = p_person_id
        or c.reported_person_id = p_person_id
        or c.reported_by_person_id = p_person_id)
  then
    raise exception 'purge_person: % is named by a safeguarding concern — as its subject, the person reported, or the reporter. That record is evidence and it names them [SAFEGUARDING.md SG-3, SG-8].', v_name
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.safeguarding_concern_notes n where n.author_person_id = p_person_id) then
    raise exception 'purge_person: % wrote a note on a safeguarding concern. That record is evidence and it names them [SAFEGUARDING.md SG-3, SG-8].', v_name
      using errcode = 'P0001';
  end if;

  -- A legal hold on a conversation preserves that conversation, and a purge
  -- would take this person's messages and their place in it away. The hold
  -- beats the erasure request, exactly as it beats retention.
  if exists (
    select 1 from public.conversations c
     where c.legal_hold
       and (exists (select 1 from public.conversation_participants cp
                     where cp.conversation_id = c.id and cp.person_id = p_person_id)
            or exists (select 1 from public.messages m
                        where m.conversation_id = c.id and m.sender_person_id = p_person_id)))
  then
    raise exception 'purge_person: % is in a conversation under a legal hold. Clear the hold first, or this cannot go ahead [SAFEGUARDING.md SG-8].', v_name
      using errcode = 'P0001';
  end if;

  -- Two references that are NOT this person's record even though the column
  -- points at them, and that the FK will not let go of: a subscription they
  -- PAY FOR on somebody else's behalf (a parent paying for a child), and an
  -- SG-6 certification exemption they GRANTED to somebody else. Both columns
  -- are `not null` and `on delete restrict`, so there is no reference to null
  -- and destroying the row would destroy the other person's record. Refuse,
  -- and say what to change.
  if exists (select 1 from public.subscriptions s
              where s.payer_person_id = p_person_id and s.person_id <> p_person_id)
  then
    raise exception 'purge_person: % pays for someone else''s subscription. Move the payer to another person first — that subscription is not theirs to take with them.', v_name
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.certification_exemptions e
              where e.granted_by_person_id = p_person_id and e.person_id <> p_person_id)
  then
    raise exception 'purge_person: % granted a certification exemption to somebody else. That exemption is the other person''s record [SAFEGUARDING.md SG-6].', v_name
      using errcode = 'P0001';
  end if;

  select pr.id into v_auth_id from public.profiles pr where pr.person_id = p_person_id;

  -- What the FK graph will take with it, counted before anything moves.
  select coalesce(jsonb_object_agg(t, n) filter (where n > 0), '{}'::jsonb)
    into v_cascaded
  from (
    select 'account_requests' as t, count(*) as n from public.account_requests where person_id = p_person_id
    union all select 'availability',              count(*) from public.availability              where person_id = p_person_id
    union all select 'board_reads',               count(*) from public.board_reads               where person_id = p_person_id
    union all select 'booking_attendance',        count(*) from public.booking_attendance        where person_id = p_person_id
    union all select 'booking_availability',      count(*) from public.booking_availability      where person_id = p_person_id
    union all select 'comms_preferences',         count(*) from public.comms_preferences         where person_id = p_person_id
    union all select 'event_responses',           count(*) from public.event_responses           where person_id = p_person_id
    union all select 'fixture_lineup_slots',      count(*) from public.fixture_lineup_slots      where person_id = p_person_id
    union all select 'media_subjects',            count(*) from public.media_subjects            where person_id = p_person_id
    union all select 'membership_people',         count(*) from public.membership_people         where person_id = p_person_id
    union all select 'neon_import_pending',       count(*) from public.neon_import_pending       where person_id = p_person_id
    union all select 'person_registration_details', count(*) from public.person_registration_details where person_id = p_person_id
    union all select 'push_tokens',               count(*) from public.push_tokens               where person_id = p_person_id
    union all select 'selections',                count(*) from public.selections                where person_id = p_person_id
    union all select 'staff_away',                count(*) from public.staff_away                where v_auth_id is not null and staff_id = v_auth_id
    union all select 'team_membership_leave_requests', count(*) from public.team_membership_leave_requests where person_id = p_person_id
    union all select 'waiting_list_access',       count(*) from public.waiting_list_access       where person_id = p_person_id
    union all select 'board_replies_on_their_posts', count(*) from public.board_replies r
                 where r.post_id in (select bp.id from public.board_posts bp where bp.author_person_id = p_person_id)
                   and r.author_person_id <> p_person_id
  ) s;

  -- Rows that survive and lose the reference, because they are someone else's
  -- record, or the club's, that merely names this person.
  select coalesce(jsonb_object_agg(t, n) filter (where n > 0), '{}'::jsonb)
    into v_nulled
  from (
    select 'payments.subscription_id' as t, count(*) as n from public.payments
       where subscription_id in (select s2.id from public.subscriptions s2
                                  where s2.person_id = p_person_id or s2.payer_person_id = p_person_id)
    union all select 'bookings.booker_person_id', count(*) from public.bookings where booker_person_id = p_person_id
    union all select 'bookings.booker_profile_id', count(*) from public.bookings where booker_profile_id is not null and booker_profile_id = v_auth_id
    union all select 'conversations.created_by_person_id', count(*) from public.conversations where created_by_person_id = p_person_id
    union all select 'outbound_messages.person_id', count(*) from public.outbound_messages where person_id = p_person_id
    union all select 'referee_match_posts.claimed_by_person_id', count(*) from public.referee_match_posts where claimed_by_person_id = p_person_id
    union all select 'team_membership_leave_requests.requested_by_person_id', count(*) from public.team_membership_leave_requests where requested_by_person_id = p_person_id
    union all select 'waiting_list_notes.author_person_id', count(*) from public.waiting_list_notes where author_person_id = p_person_id
    union all select 'audit_log.actor_id', count(*) from public.audit_log where actor_id is not null and actor_id = v_auth_id
  ) s;

  -- The audit row comes FIRST, and its id is the ticket the delete guard asks
  -- for. It survives the purge: audit_log is not on the guard's allowlist.
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(),
          (select u.email from auth.users u where u.id = auth.uid()),
          'people.purged',
          'people',
          p_person_id::text,
          jsonb_build_object(
            'person_name',  v_name,
            'auth_user_id', v_auth_id,
            'reason',       p_reason,
            'cascaded',     v_cascaded,
            'nulled',       v_nulled))
  returning id into v_ticket;

  perform set_config('app.purge_ticket', v_ticket::text, true);

  -- ---------------------------------------------------------------------------
  -- Children first, in dependency order. Everything here is `on delete
  -- restrict`: the database would refuse the `people` delete until it is gone.
  -- ---------------------------------------------------------------------------

  -- Messaging. The referee cards and the attachments RESTRICT their message,
  -- so they lead; mentions cascade but are named anyway so the count is real.
  delete from public.referee_match_posts
   where posted_by_person_id = p_person_id
      or message_id in (select id from public.messages where sender_person_id = p_person_id);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('referee_match_posts', v_n); end if;

  delete from public.message_mentions
   where person_id = p_person_id
      or message_id in (select id from public.messages where sender_person_id = p_person_id);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('message_mentions', v_n); end if;

  delete from public.message_reactions
   where person_id = p_person_id
      or message_id in (select id from public.messages where sender_person_id = p_person_id);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('message_reactions', v_n); end if;

  delete from public.message_attachments
   where message_id in (select id from public.messages where sender_person_id = p_person_id);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('message_attachments', v_n); end if;

  delete from public.messages where sender_person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('messages', v_n); end if;

  select coalesce(array_agg(distinct conversation_id), '{}'::uuid[]) into v_convs
    from public.conversation_participants where person_id = p_person_id;

  delete from public.conversation_participants where person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('conversation_participants', v_n); end if;

  -- SG-1.7, which nothing else here would have caught: taking a participant
  -- out of a room can leave exactly one adult alone with one minor and no
  -- guardian. A DELETE fires no participant guard (SG-1 is enforced on INSERT
  -- and on `left_at`), so the purge checks for itself and does what SG-1.8's
  -- refusal tells an administrator to do — closes the room. The history stays;
  -- only the room stops being open.
  update public.conversations c
     set closed_at = now()
   where c.id = any (v_convs)
     and c.closed_at is null
     and not public.conversation_is_compliant(c.id);
  get diagnostics v_closed = row_count;

  -- Noticeboard. Their replies go first so a reply of theirs on someone else's
  -- post is counted as a reply, not swept up as a cascade.
  delete from public.board_replies where author_person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('board_replies', v_n); end if;

  delete from public.board_posts where author_person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('board_posts', v_n); end if;

  -- Football, compliance, identity, membership.
  delete from public.fixture_player_stats where person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('fixture_player_stats', v_n); end if;

  delete from public.emergency_contacts where person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('emergency_contacts', v_n); end if;

  delete from public.identity_documents where person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('identity_documents', v_n); end if;

  delete from public.certification_exemptions
   where person_id = p_person_id or granted_by_person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('certification_exemptions', v_n); end if;

  delete from public.certifications where person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('certifications', v_n); end if;

  delete from public.guardian_consents
   where child_person_id = p_person_id or guardian_person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('guardian_consents', v_n); end if;

  -- `guardianships` has its own BEFORE DELETE guard (SG-1.8). It is not
  -- bypassed and not disabled: the participant rows above are already gone, so
  -- removing the link cannot leave anybody alone with a minor, and the guard
  -- lets it through on its own terms.
  delete from public.guardianships
   where child_person_id = p_person_id or guardian_person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('guardianships', v_n); end if;

  delete from public.person_roles where person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('person_roles', v_n); end if;

  delete from public.team_memberships where person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('team_memberships', v_n); end if;

  delete from public.registrations where person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('registrations', v_n); end if;

  -- The club's books stay; only the link to the erased member's subscription
  -- goes. `payments.subscription_id` is `on delete restrict`, so this is the
  -- one reference the purge has to release by hand.
  update public.payments set subscription_id = null
   where subscription_id in (select s.id from public.subscriptions s
                              where s.person_id = p_person_id or s.payer_person_id = p_person_id);

  delete from public.subscriptions
   where person_id = p_person_id or payer_person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('subscriptions', v_n); end if;

  delete from public.memberships where primary_person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('memberships', v_n); end if;

  -- The login's own row. `auth.users` itself is not reachable from here; the
  -- web layer deletes it with the service-role admin client immediately after
  -- this function returns, and `profiles.id references auth.users on delete
  -- cascade` means that is a no-op for this row by then.
  delete from public.profiles where person_id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('profiles', v_n); end if;

  delete from public.people where id = p_person_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('people', v_n); end if;

  perform set_config('app.purge_ticket', '', true);

  return jsonb_build_object(
    'person_id',    p_person_id,
    'person_name',  v_name,
    'auth_user_id', v_auth_id,
    'reason',       p_reason,
    'audit_log_id', v_ticket,
    'deleted',      v_deleted || v_cascaded,
    'nulled',       v_nulled,
    'conversations_closed', v_closed);
end;
$$;

revoke all privileges on function public.purge_person(uuid, text) from public, anon;
grant execute on function public.purge_person(uuid, text) to authenticated, service_role;

comment on function public.purge_person(uuid, text) is
  'Super user only (42501 otherwise): destroy one person and everything that references them, in dependency order, and return a jsonb summary of what was deleted and what was nulled. Refuses (P0001) anyone under a legal hold, anyone named by a safeguarding concern or one of its notes, and the caller themselves. audit_log, safeguarding_concerns and media_items are never touched; the people.purged audit row survives the purge [SAFEGUARDING.md SG-2, SG-7, SG-8].';


notify pgrst, 'reload schema';


-- =============================================================================
-- ROLLBACK (documented, not executed)
-- =============================================================================
--   drop function if exists public.purge_person(uuid, text);
--   drop function if exists public.purge_message(uuid, text);
--   drop function if exists public.is_super_user();
--   -- and restore deny_hard_delete() to its 20260822100000_people.sql body,
--   -- i.e. the same function without the ticket branch. Restoring it closes
--   -- the door for good; it does not resurrect anything a purge destroyed,
--   -- which is the whole point of the audit row.
-- =============================================================================
