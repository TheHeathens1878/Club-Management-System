-- =============================================================================
-- Phase 4/5 — scheduled Edge Function invocations (pg_cron → pg_net → Vault)
-- =============================================================================
-- Uses P2.4's `public.invoke_edge_function(name, body)`, which is a no-op with
-- a NOTICE until the Vault secrets `project_url` and `service_role_key` exist.
-- Times are UTC. Every job is idempotent on the database side (P4.2 per-tier
-- guard, P4.3 certification_nudges, P4.4 queued status, P4.5 needs_quarantine).

select cron.schedule('comms-dispatch-5min',        '*/5 * * * *', $cron$ select public.invoke_edge_function('comms-dispatch') $cron$);
select cron.schedule('media-quarantine-10min',     '*/10 * * * *', $cron$ select public.invoke_edge_function('media-quarantine') $cron$);
select cron.schedule('safeguarding-nudges-daily',  '30 6 * * *',  $cron$ select public.invoke_edge_function('safeguarding-nudges') $cron$);
select cron.schedule('arrears-reminders-weekly',    '0 9 * * 2',   $cron$ select public.invoke_edge_function('arrears-reminders') $cron$);
select cron.schedule('retention-dry-run-weekly',   '0 4 * * 1',   $cron$ select public.retention_run(true) $cron$);

-- Rollback: select cron.unschedule(jobname) for each of the five names.
