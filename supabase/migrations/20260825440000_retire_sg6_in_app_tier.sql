-- =============================================================================
-- SG-6's in-app tier is retired: certifications become a read-only archive
-- =============================================================================
-- Adam, club owner, 2026-08-26: "remove all DBS, Safeguarding and Coaching
-- qualifications from the App. We use the FA's Club Portal for this."
--
-- This finishes what 20260824240000_sg6_enforcement_off.sql started. That
-- migration turned the tier-1 hard block into a switch and set it to OFF,
-- because the FA Clubs Portal is the club's system of record and duplicating
-- the block in-app refused approvals for paperwork already verified there.
-- What it left behind was screens: a Certifications panel on a person, another
-- on a team, DBS/Safeguarding columns on every squad card, a "DBS due" badge on
-- the people list and a nightly compliance report — all of them showing a
-- status nobody in the club acts on any more, because nobody maintains the
-- records that produce it. Those screens go in this commit.
--
-- WHAT THIS MIGRATION DOES *NOT* DO
-- ---------------------------------
-- It does not drop `certifications`, `certification_exemptions`,
-- `child_facing_roles`, the SG-6 evaluator or any of the tier-2 functions.
-- Those tables hold historical records — every DBS the club recorded, every
-- exemption a safeguarding lead granted and the audit rows that name them —
-- and a drop is irreversible. The club has asked to stop USING them, which is
-- not the same as destroying them. Dropping them is a separate, deliberate
-- step, available on request.
--
-- WHAT IT DOES
-- ------------
--   1. Takes INSERT/UPDATE/DELETE on the two evidence tables away from
--      `authenticated`, so no signed-in user — and therefore nothing in the
--      app — can add to a set of records nobody maintains any more. SELECT is
--      untouched: the history stays readable to exactly the same people, under
--      exactly the same policies. `service_role` is untouched, so a considered
--      back-office correction and any future re-enablement are still possible
--      without a migration.
--   2. Asserts (rather than assumes) that `sg6_enforcement_enabled()` reads
--      `site_settings['safeguarding.sg6_enforcement']`, and ensures that key
--      is '0'. With the app unable to write a certification, a switch that
--      flipped back to '1' by accident would refuse every child-facing team
--      assignment with no way in the app to satisfy it. This makes the state
--      explicit and checked instead of inherited.
--
-- RE-ENABLING, in full: grant insert, update on the two tables back to
-- `authenticated`, restore the app's panels, and
--   update public.site_settings set value = '1'
--    where key = 'safeguarding.sg6_enforcement';
-- Nothing here is destructive, so that is the whole rollback.
--
-- SAFEGUARDING.md SG-6 and §6.1 carry the matching amendment in this commit;
-- DECISIONS.md carries the §6.2 record of the weakening and its owner.
--
-- Data touched: none. No row is inserted, updated or deleted by this
-- migration except the `safeguarding.sg6_enforcement` setting, which is
-- already '0' on production and is re-asserted idempotently.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The app can no longer write a certification or an exemption
-- -----------------------------------------------------------------------------
-- P2.1 (20260823120000 §12) granted `select, insert, update` on both tables to
-- `authenticated` and `service_role`, and revoked delete/truncate from
-- everyone (SG-2, and that stands). Only the `authenticated` write half is
-- withdrawn here.
--
-- The RLS policies are deliberately left in place. A policy with no underlying
-- grant is inert, and leaving them means re-enabling is a GRANT rather than a
-- rewrite of the club_admin / safeguarding_lead rules.
revoke insert, update, delete on public.certifications           from authenticated;
revoke insert, update, delete on public.certification_exemptions from authenticated;

comment on table public.certifications is
  'Historical record only, from 2026-08-26. DBS checks, safeguarding and coaching qualifications are held on the FA Clubs Portal, which is the club''s system of record; the app no longer records or displays them. `authenticated` has SELECT and nothing else, so the rows can still be read by the people the policies always admitted but cannot be added to or edited from the app. Kept, not dropped: this is the evidence of what the club held and when. See SAFEGUARDING.md SG-6.';

comment on table public.certification_exemptions is
  'Historical record only, from 2026-08-26 — the safeguarding lead''s 30-day exemptions from the retired in-app SG-6 tier. `authenticated` has SELECT and nothing else; `certification_exemptions_guard()` and the SG-7 audit trigger are unchanged and still bind `service_role`. See SAFEGUARDING.md SG-6.';

-- -----------------------------------------------------------------------------
-- 2. The switch is what we think it is, and it is off
-- -----------------------------------------------------------------------------
-- Asserted, not assumed: if `sg6_enforcement_enabled()` were ever redefined to
-- read some other key, silently leaving this migration's guarantee unmet, the
-- migration fails here rather than on a Saturday morning when an administrator
-- cannot add a coach.
do $do$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sg6_enforcement_enabled'
     and p.pronargs = 0;

  if v_src is null then
    raise exception
      'sg6_enforcement_enabled() is missing — SG-6 tier 1 has no switch to check [SAFEGUARDING.md SG-6]';
  end if;

  if position('safeguarding.sg6_enforcement' in v_src) = 0 then
    raise exception
      'sg6_enforcement_enabled() no longer reads site_settings[''safeguarding.sg6_enforcement''] — this migration cannot guarantee the tier is off [SAFEGUARDING.md SG-6]';
  end if;
end
$do$;

-- Ensure the value rather than assume it. `safeguarding.%` keys are
-- integer-only and cannot be deleted (SG-10 settings guard), so this is the
-- only way the switch ever moves, and it is audited by
-- `site_settings_safeguarding_audit()`.
insert into public.site_settings (key, value)
  values ('safeguarding.sg6_enforcement', '0')
  on conflict (key) do update
    set value = '0', updated_at = now()
    where site_settings.value is distinct from '0';

-- And prove it took, in the same transaction that claims it.
do $do$
begin
  if public.sg6_enforcement_enabled() then
    raise exception
      'SG-6 tier-1 enforcement is still ON after this migration — refusing to leave the app unable to write the certifications the guard would demand [SAFEGUARDING.md SG-6]';
  end if;
end
$do$;

notify pgrst, 'reload schema';
