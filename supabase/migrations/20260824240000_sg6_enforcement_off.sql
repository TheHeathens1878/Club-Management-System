-- =============================================================================
-- SG-6 tier 1 becomes a switch, and the switch is set to OFF
-- =============================================================================
-- Adam's decision, 2026-08-23: DBS checks and safeguarding qualifications are
-- recorded and enforced on the FA Clubs Portal — the FA's own system of
-- record. Duplicating that enforcement in-app blocked legitimate approvals
-- ("Adam Wareing may not hold the child-facing role coach…") for paperwork the
-- club has already verified elsewhere, so in-app enforcement is now off.
--
-- The machinery is kept, not deleted: `is_child_facing_compliant()` remains
-- THE shared evaluation function for every SG-6 entry point (membership guard,
-- composition side, dob side, account-request approval), and it now consults
-- `site_settings['safeguarding.sg6_enforcement']` (integer: 1 = enforce,
-- 0 = off; the safeguarding settings guard requires plain integers). Turning
-- it back on is a one-row settings change. Certifications, exemptions, expiry
-- nudges and the compliance report are untouched — they record and report;
-- they no longer refuse.
--
-- SAFEGUARDING.md SG-6 carries the matching amendment in this commit.
--
-- Rollback: update public.site_settings set value = '1'
--           where key = 'safeguarding.sg6_enforcement';
-- =============================================================================

-- The switch. safeguarding.% keys are integer-only (SG-10 settings guard) and
-- cannot be deleted, which suits a policy switch: it can only be flipped,
-- attributably, through the audited settings path.
insert into public.site_settings (key, value)
  values ('safeguarding.sg6_enforcement', '0')
  on conflict (key) do update set value = '0', updated_at = now();

create or replace function public.sg6_enforcement_enabled()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(value), '')::integer from public.site_settings where key = 'safeguarding.sg6_enforcement'),
    1
  ) <> 0;
$$;
revoke all privileges on function public.sg6_enforcement_enabled() from public, anon;
grant execute on function public.sg6_enforcement_enabled() to authenticated, service_role;

-- The ONE shared evaluator (SAFEGUARDING.md SG-6 tier 1) — unchanged in shape,
-- now short-circuiting to compliant when enforcement is off.
create or replace function public.is_child_facing_compliant(p_person_id uuid, p_team_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select (not public.sg6_enforcement_enabled())
      or (public.has_current_certification(p_person_id, 'fa_dbs')
          and public.has_current_certification(p_person_id, 'safeguarding_children'))
      or public.has_active_exemption(p_person_id, p_team_id);
$$;

notify pgrst, 'reload schema';
