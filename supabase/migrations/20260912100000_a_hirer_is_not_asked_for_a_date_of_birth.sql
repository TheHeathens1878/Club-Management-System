-- =============================================================================
-- A hirer is not asked for a date of birth (2026-09-12)
-- =============================================================================
-- Since the `booker` role landed (20260905120000) every hirer's account has
-- been unable to open its portal. The sign-up trigger gives every new login a
-- `people` row, with no date of birth; `needs_dob_completion()` then says
-- true; the middleware sends them to /complete-profile; and the signed-in
-- layout, which hosts that page, sends a booker straight back to /portal.
-- ERR_TOO_MANY_REDIRECTS, for all six hirers on prod, three of whom have
-- tried to sign in since. Nobody could pay a deposit online.
--
-- The date of birth exists for safeguarding (SG-0 treats an unknown one as a
-- minor and hides teams). A hirer has no teams to hide and no membership to
-- apply; the club needs nothing from them but a name, an address and the
-- money. So the question is not asked of a booker.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n — one security-definer
-- function restated, no table or policy change; data touched: none;
-- rollback: restate the function from 20260825340000.
-- =============================================================================

create or replace function public.needs_dob_completion()
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.people p
     where p.id = public.current_person_id()
       and p.dob is null
       and p.deleted_at is null
  )
  and not exists (
    select 1 from public.profiles pr
     where pr.id = auth.uid()
       and pr.role = 'booker'
  );
$$;

comment on function public.needs_dob_completion() is
  'True when the signed-in person has no date of birth on record — unless they are a hirer (profiles.role = booker), who is asked for nothing beyond the booking. The middleware holds everyone else at /complete-profile until they give it (Adam, 2026-08-25: mandatory at first login).';
