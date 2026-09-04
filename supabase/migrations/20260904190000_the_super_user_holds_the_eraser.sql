-- =============================================================================
-- The super user holds the eraser (Adam, 2026-09-04: "Super users should be
-- able to delete plans and charges")
--
-- PLANS were already deletable: fee_plans carries no deny trigger, the
-- finance FOR ALL policy covers DELETE, and the RESTRICT foreign keys from
-- billing_agreements and charges make "in use" a database answer, not a
-- convention. Nothing to change below but the screen, which gains the button.
--
-- CHARGES were deliberately absolute (20260904180000 gave them the SG-2
-- treatment). Adam has asked for the eraser, so the blanket refusal becomes a
-- purpose-built guard, following the 20260825380000 purge precedent — allowed,
-- but never silent and never able to lose money:
--
--   * ONLY a super user (`profiles.role = 'super_user'` — Adam is the sole
--     holder) passes. The finance role, club_admin, service_role and the
--     table owner are all still refused by the trigger; the FOR DELETE
--     policy names is_super_user() too, so RLS filters what the trigger
--     would refuse anyway.
--   * A charge with money against it cannot be deleted — payments would be
--     orphaned and the reconciliation would lie. Refund/void/waive are the
--     tools once money has moved. (payments.charge_id ON DELETE RESTRICT
--     stays underneath as the backstop.)
--   * The deletion is audited BEFORE the row goes: `finance.charge_deleted`
--     carries the entire old row, so "what was destroyed, by whom" is a
--     precondition of destroying it.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one FOR DELETE policy on
-- charges); data touched: none; rollback: drop policy charges_super_delete;
-- revoke delete on charges from authenticated; drop trigger
-- trg_charges_delete_guard + function charges_delete_guard(); recreate
-- trg_charges_no_delete with public.deny_hard_delete().
-- =============================================================================

drop trigger trg_charges_no_delete on public.charges;

create or replace function public.charges_delete_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not public.is_super_user() then
    raise exception
      'charges: only a super user deletes a charge — waive it (with a reason) or void it instead'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payments p where p.charge_id = old.id) then
    raise exception
      'charges: money has moved against CHG-% — refund the payment first; a charge with payments is never deleted'
      , old.charge_no
      using errcode = 'P0001';
  end if;
  perform public.write_audit('finance.charge_deleted', 'charges', old.id::text, to_jsonb(old));
  return old;
end;
$$;

create trigger trg_charges_delete_guard
  before delete on public.charges
  for each row execute function public.charges_delete_guard();

revoke all privileges on function public.charges_delete_guard() from public, anon, authenticated, service_role;

create policy "charges_super_delete" on public.charges for delete to authenticated
  using (public.is_super_user());

grant delete on public.charges to authenticated;

comment on trigger trg_charges_delete_guard on public.charges is
  'Super user only, unpaid only, audited before the row goes. Replaces the blanket SG-2 refusal at Adam''s 2026-09-04 direction.';

notify pgrst, 'reload schema';
