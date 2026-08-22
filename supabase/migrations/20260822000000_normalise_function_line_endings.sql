-- =============================================================================
-- Normalise line endings in the five production functions
-- =============================================================================
-- PLAN.md task P0.2 follow-up.
--
-- The five functions on prod were authored in the dashboard SQL editor, which
-- stored their bodies with CRLF line endings. The repo is LF-only, so
-- `supabase db diff` perpetually reports five spurious `create or replace
-- function` statements. This migration re-creates each function with the
-- IDENTICAL body (only the line endings differ) so that prod matches the repo
-- byte-for-byte.
--
-- Semantically a no-op: signatures, language, volatility, SECURITY DEFINER and
-- search_path are unchanged. `create or replace` keeps existing grants, the
-- dependent RLS policies and the triggers intact.
-- =============================================================================

create or replace function public.is_committee()
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select coalesce(
    (select role in ('committee', 'super_user') from profiles where id = auth.uid()),
    false
  );
$function$;

create or replace function public.is_bar_manager()
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select coalesce(
    (select role in ('bar_manager', 'committee', 'super_user') from profiles where id = auth.uid()),
    false
  );
$function$;

create or replace function public.is_staff()
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select coalesce(
    (select role in ('committee', 'bar', 'bar_manager', 'super_user', 'staff') from profiles where id = auth.uid()),
    false
  );
$function$;

create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end $function$;

create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  insert into profiles (id, role, full_name)
  values (new.id, 'member', new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $function$;
