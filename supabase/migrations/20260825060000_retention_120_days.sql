-- D7 resolved (Adam, 2026-08-25): "Messages should be kept for 120 days and
-- then deleted to save space." Retention turns ON with a 120-DAY period.
--
-- "Deleted" is implemented as the redaction P5.6 built, not row deletion —
-- SG-2 forbids hard deletes of messages, and the redaction trigger replaces
-- the body with '[redacted]' so the content is gone and the space is freed
-- while the row skeleton and the audit trail survive. Legal holds, open
-- concerns and `audit_log` remain exempt exactly as before (SG-8).
--
-- Three moves:
--   1. the period becomes day-granular: `retention.messages_days` = 120
--      replaces `retention.messages_months`, and
--      `message_retention_candidates()` reads it;
--   2. `retention.enabled` flips to 'true';
--   3. the Monday 04:00 job stops being a permanent dry-run: it now calls
--      `retention_run(false)` — still forced back to dry-run any time
--      `retention.enabled` is switched off.

insert into public.site_settings (key, value)
values ('retention.messages_days', '120')
on conflict (key) do update set value = excluded.value;

delete from public.site_settings where key = 'retention.messages_months';

-- Same predicate as P5.6 wrote it, with only the period clause changed.
create or replace function public.message_retention_candidates()
  returns table (message_id uuid, conversation_id uuid, created_at timestamptz)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select m.id, m.conversation_id, m.created_at
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.redacted_at is null
    and m.created_at < now() - make_interval(days => coalesce((select value::integer from public.site_settings where key = 'retention.messages_days'), 120))
    and not c.legal_hold
    and not exists (select 1 from public.conversation_participants p join public.people pp on pp.id = p.person_id
                    where p.conversation_id = c.id and p.left_at is null and pp.legal_hold)
    and not exists (select 1 from public.safeguarding_concerns sc
                    where sc.status <> 'closed' and sc.deleted_at is null
                      and sc.narrative like '%conversation:' || c.id::text || '%')
    and (auth.uid() is null or public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[]));
$$;

update public.site_settings set value = 'true' where key = 'retention.enabled';
insert into public.site_settings (key, value) values ('retention.enabled', 'true')
on conflict (key) do nothing;

select cron.unschedule('retention-dry-run-weekly');
select cron.schedule('retention-weekly', '0 4 * * 1', $cron$ select public.retention_run(false) $cron$);

notify pgrst, 'reload schema';
