-- =============================================================================
-- P4.5 — media on Supabase Storage with consent-filtered read paths (SG-5)
-- =============================================================================
-- PLAN.md task P4.5 ("Media on Supabase Storage (per Q4; image transforms +
-- signed URLs, no Cloudinary): albums per team/event, per-child photo-consent
-- enforcement — children without consent excluded from bulk downloads and
-- public galleries at query level"; acceptance: "unconsented child's photos
-- never appear in bulk export; signed URLs expire"). Linear TH1-32.
--
-- SG-5 AS WRITTEN
--   * The only supported read paths for media are views/functions that join
--     to consent and filter. `authenticated` has NO SELECT on `media_items`,
--     `media_subjects` or `media_albums`; it reads through
--     `media_gallery(album_id)` and `media_export(album_id)` (SECURITY
--     DEFINER), and the Storage bucket is PRIVATE — objects are reached only
--     by short-lived signed URLs the app mints after calling those functions
--     (TTL ≤ 15 min — enforced in the app and recorded in
--     `media.signed_url_ttl_seconds`, default 900).
--   * Consent is per child per purpose on `guardian_consents` (P2.2):
--     `photo_team_album`, `photo_club_website`, `photo_social_media`,
--     `photo_press`. Absence = refused. `media_albums.visibility` maps to the
--     purpose it requires: team → photo_team_album; club → photo_club_website;
--     public → photo_club_website; social → photo_social_media; press →
--     photo_press.
--   * An item is SHOWABLE for an album's purpose when every minor subject has
--     an active consent for that purpose (`has_active_consent`), and
--     UNTAGGED MEDIA FAILS CLOSED: `subjects_confirmed = false` (no human has
--     said who is in it) excludes it from every gallery and export. An item
--     with `subjects_confirmed = true` and no subject rows is a photo of
--     nobody in particular (a pitch, a trophy) and shows.
--   * Withdrawal is immediate at query level; the app additionally moves the
--     object (`media_items.storage_path` → `quarantine/`) when consent is
--     withdrawn so existing signatures break (`media_items_on_consent_change`
--     marks `needs_quarantine`; the `media-quarantine` Edge Function moves
--     the object and clears it).
--   * Every bulk export writes `media.bulk_export` with
--     `{ item_count, excluded_unconsented }` (SG-7) before returning.
--   * SG-8: `media_items.legal_hold`, `redacted_at`; retention is D7 (no job).
--
-- PR METADATA: migrations y; RLS y (three new tables, no authenticated table
-- reads); data touched: one site_settings row; rollback: §9.
-- =============================================================================


-- =============================================================================
-- 1. ENUMS AND SETTINGS
-- =============================================================================

create type public.album_visibility as enum ('team', 'club', 'public', 'social', 'press');

insert into public.site_settings (key, value) values ('media.signed_url_ttl_seconds', '900') on conflict (key) do nothing;

create or replace function public.album_consent_type(p_visibility public.album_visibility)
  returns public.consent_type
  language sql
  immutable
as $$
  select case p_visibility
    when 'team' then 'photo_team_album'::public.consent_type
    when 'club' then 'photo_club_website'::public.consent_type
    when 'public' then 'photo_club_website'::public.consent_type
    when 'social' then 'photo_social_media'::public.consent_type
    when 'press' then 'photo_press'::public.consent_type
  end;
$$;


-- =============================================================================
-- 2. TABLES
-- =============================================================================

create table public.media_albums (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  visibility   public.album_visibility not null default 'team',
  team_id      uuid references public.teams (id) on delete set null,
  season_id    uuid references public.seasons (id) on delete set null,
  fixture_id   uuid references public.fixtures (id) on delete set null,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint media_albums_title_not_blank check (btrim(title) <> ''),
  constraint media_albums_team_album_has_team check (visibility <> 'team' or team_id is not null)
);

create trigger trg_media_albums_updated
  before update on public.media_albums
  for each row execute function public.set_updated_at();

create table public.media_items (
  id                  uuid primary key default gen_random_uuid(),
  album_id            uuid not null references public.media_albums (id) on delete restrict,
  storage_bucket      text not null default 'media',
  storage_path        text not null,
  content_type        text,
  byte_size           integer check (byte_size is null or byte_size >= 0),
  width               integer,
  height              integer,
  caption             text,
  taken_at            timestamptz,
  subjects_confirmed  boolean not null default false,
  confirmed_by        uuid references auth.users (id) on delete set null,
  confirmed_at        timestamptz,
  legal_hold          boolean not null default false,
  redacted_at         timestamptz,
  needs_quarantine    boolean not null default false,
  uploaded_by         uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create index media_items_album_idx on public.media_items (album_id, created_at desc);
create index media_items_quarantine_idx on public.media_items (id) where needs_quarantine;

create trigger trg_media_items_updated
  before update on public.media_items
  for each row execute function public.set_updated_at();

create table public.media_subjects (
  media_item_id  uuid not null references public.media_items (id) on delete cascade,
  person_id      uuid not null references public.people (id) on delete cascade,
  tagged_by      uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (media_item_id, person_id)
);

create index media_subjects_person_idx on public.media_subjects (person_id);

comment on table public.media_items is
  'SG-5: authenticated has no SELECT here. Read through media_gallery()/media_export(); objects via short-lived signed URLs only.';


-- =============================================================================
-- 3. THE CONSENT RULE, IN ONE PLACE
-- =============================================================================

-- Is this item showable for the given purpose? Untagged fails closed; every
-- minor subject needs an active consent; adults are outside SG-5.
create or replace function public.media_item_showable(p_item_id uuid, p_purpose public.consent_type)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select i.subjects_confirmed
     and i.redacted_at is null
     and not i.needs_quarantine
     and not exists (
       select 1 from public.media_subjects s
       where s.media_item_id = i.id
         and public.is_minor(s.person_id)
         and not public.has_active_consent(s.person_id, p_purpose))
  from public.media_items i where i.id = p_item_id;
$$;

-- Who may open an album at all (before consent filtering).
create or replace function public.can_view_album(p_album_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.media_albums a
    where a.id = p_album_id
      and (public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[])
           or a.visibility in ('club', 'public', 'social', 'press')
           or (a.visibility = 'team' and (public.is_team_member(a.team_id) or public.is_team_guardian(a.team_id)))));
$$;

-- The gallery: only showable items for the album's purpose. SECURITY DEFINER
-- because authenticated has no table grant; the filter cannot be forgotten.
create or replace function public.media_gallery(p_album_id uuid)
  returns table (id uuid, album_id uuid, storage_bucket text, storage_path text, content_type text,
                 width integer, height integer, caption text, taken_at timestamptz, created_at timestamptz)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_purpose public.consent_type;
begin
  if auth.uid() is not null and not public.can_view_album(p_album_id) then
    return;
  end if;
  select public.album_consent_type(a.visibility) into v_purpose from public.media_albums a where a.id = p_album_id;
  return query
    select i.id, i.album_id, i.storage_bucket, i.storage_path, i.content_type, i.width, i.height, i.caption, i.taken_at, i.created_at
    from public.media_items i
    where i.album_id = p_album_id and public.media_item_showable(i.id, v_purpose)
    order by coalesce(i.taken_at, i.created_at);
end;
$$;

-- Bulk export: the same filter, plus the SG-7 audit row with the counts,
-- written BEFORE returning. club_admin / team staff / service_role.
create or replace function public.media_export(p_album_id uuid)
  returns table (id uuid, storage_bucket text, storage_path text, content_type text, caption text, taken_at timestamptz)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_purpose public.consent_type;
  v_team uuid;
  v_total integer;
  v_shown integer;
begin
  select public.album_consent_type(a.visibility), a.team_id into v_purpose, v_team from public.media_albums a where a.id = p_album_id;
  if v_purpose is null then
    raise exception 'media_export: unknown album %', p_album_id using errcode = 'P0001';
  end if;
  if auth.uid() is not null and not (public.is_club_admin() or (v_team is not null and public.is_team_staff(v_team))) then
    raise exception 'media_export: club_admin or the team''s staff only' using errcode = '42501';
  end if;
  select count(*), count(*) filter (where public.media_item_showable(i.id, v_purpose))
    into v_total, v_shown
  from public.media_items i where i.album_id = p_album_id;
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select u.email from auth.users u where u.id = auth.uid()),
          'media.bulk_export', 'media_albums', p_album_id::text,
          jsonb_build_object('item_count', v_shown, 'excluded_unconsented', v_total - v_shown));
  return query
    select i.id, i.storage_bucket, i.storage_path, i.content_type, i.caption, i.taken_at
    from public.media_items i
    where i.album_id = p_album_id and public.media_item_showable(i.id, v_purpose)
    order by coalesce(i.taken_at, i.created_at);
end;
$$;

-- Tagging confirms nothing by itself; a human confirms the subject list.
create or replace function public.confirm_media_subjects(p_item_id uuid, p_person_ids uuid[])
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_team uuid;
begin
  select a.team_id into v_team from public.media_items i join public.media_albums a on a.id = i.album_id where i.id = p_item_id;
  if auth.uid() is not null and not (public.is_club_admin() or (v_team is not null and public.is_team_staff(v_team))) then
    raise exception 'confirm_media_subjects: club_admin or the team''s staff only' using errcode = '42501';
  end if;
  delete from public.media_subjects where media_item_id = p_item_id;
  insert into public.media_subjects (media_item_id, person_id, tagged_by)
  select p_item_id, unnest(p_person_ids), auth.uid();
  update public.media_items set subjects_confirmed = true, confirmed_by = auth.uid(), confirmed_at = now() where id = p_item_id;
end;
$$;


-- =============================================================================
-- 4. WITHDRAWAL → QUARANTINE (break existing signatures)
-- =============================================================================

create or replace function public.media_on_consent_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.consent_type::text like 'photo_%' and new.revoked_at is not null and old.revoked_at is null then
    update public.media_items i
       set needs_quarantine = true
     where exists (select 1 from public.media_subjects s where s.media_item_id = i.id and s.person_id = new.child_person_id)
       and i.redacted_at is null;
  end if;
  return new;
end;
$$;

create trigger trg_guardian_consents_media_quarantine
  after update of revoked_at on public.guardian_consents
  for each row execute function public.media_on_consent_change();

-- The Edge Function moves the object then calls this.
create or replace function public.media_quarantined(p_item_id uuid, p_new_path text)
  returns void
  language sql
  security definer
  set search_path = public
as $$
  update public.media_items set storage_path = p_new_path, needs_quarantine = false where id = p_item_id;
$$;


-- =============================================================================
-- 5. SG-8 on media
-- =============================================================================

create or replace function public.media_items_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.legal_hold is distinct from old.legal_hold and auth.uid() is not null and not public.is_safeguarding_lead() then
    raise exception 'media_items.legal_hold may only be set or cleared by a safeguarding_lead [SAFEGUARDING.md SG-8]' using errcode = '42501';
  end if;
  if new.redacted_at is not null and old.redacted_at is null and new.legal_hold then
    raise exception 'media_items: cannot redact an item under legal hold [SAFEGUARDING.md SG-8]' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_media_items_guard
  before update of legal_hold, redacted_at on public.media_items
  for each row execute function public.media_items_guard();

create trigger trg_media_items_deny_hard_delete
  before delete on public.media_items
  for each row execute function public.deny_hard_delete();


-- =============================================================================
-- 6. RLS + PRIVILEGES
-- =============================================================================

alter table public.media_albums   enable row level security;
alter table public.media_items    enable row level security;
alter table public.media_subjects enable row level security;

-- Albums: readable (metadata only) by those who may view; written by admins/staff.
create policy "media_albums_read" on public.media_albums for select to authenticated
  using (public.can_view_album(id));
create policy "media_albums_staff_write" on public.media_albums for all to authenticated
  using (public.is_club_admin() or (team_id is not null and public.is_team_staff(team_id)))
  with check (public.is_club_admin() or (team_id is not null and public.is_team_staff(team_id)));

-- Items/subjects: NO SELECT policy for authenticated — reads go through the functions.
create policy "media_items_staff_insert" on public.media_items for insert to authenticated
  with check (exists (select 1 from public.media_albums a where a.id = album_id
                      and (public.is_club_admin() or (a.team_id is not null and public.is_team_staff(a.team_id)))));
create policy "media_items_staff_update" on public.media_items for update to authenticated
  using (exists (select 1 from public.media_albums a where a.id = album_id
                 and (public.is_club_admin() or (a.team_id is not null and public.is_team_staff(a.team_id)))))
  with check (true);

revoke all privileges on public.media_albums, public.media_items, public.media_subjects from anon, authenticated, service_role;
grant select, insert, update, delete on public.media_albums to authenticated, service_role;
grant insert, update on public.media_items to authenticated;           -- no SELECT (SG-5)
grant select, insert, update on public.media_items to service_role;
grant select, insert, update, delete on public.media_subjects to service_role;  -- authenticated: nothing (via confirm_media_subjects)
revoke delete on public.media_items from anon, authenticated, service_role;

revoke all privileges on function public.media_item_showable(uuid, public.consent_type) from public, anon;
revoke all privileges on function public.can_view_album(uuid) from public, anon;
revoke all privileges on function public.media_gallery(uuid) from public, anon;
revoke all privileges on function public.media_export(uuid) from public, anon;
revoke all privileges on function public.confirm_media_subjects(uuid, uuid[]) from public, anon;
grant execute on function public.media_item_showable(uuid, public.consent_type), public.can_view_album(uuid),
  public.media_gallery(uuid), public.media_export(uuid), public.confirm_media_subjects(uuid, uuid[]) to authenticated, service_role;
revoke all privileges on function public.media_quarantined(uuid, text) from public, anon, authenticated;
grant execute on function public.media_quarantined(uuid, text) to service_role;
revoke all privileges on function public.media_on_consent_change() from public, anon, authenticated, service_role;
revoke all privileges on function public.media_items_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.album_consent_type(public.album_visibility) from public, anon;
grant execute on function public.album_consent_type(public.album_visibility) to authenticated, service_role;


-- =============================================================================
-- 7. STORAGE BUCKET (private) + policies
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4'])
on conflict (id) do nothing;

-- Uploads by admins / team staff only; no direct reads for authenticated — the
-- app mints signed URLs with the service key after media_gallery()/media_export().
create policy "media_staff_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (public.is_club_admin()
              or exists (select 1 from public.team_memberships m
                         where m.person_id = public.current_person_id() and m.left_at is null and public.is_child_facing_role(m.role))));

notify pgrst, 'reload schema';


-- =============================================================================
-- 9. ROLLBACK (documented, not executed)
-- =============================================================================
-- drop policy media_staff_upload on storage.objects; delete from storage.buckets
-- where id = 'media' (after emptying it); drop the trigger on guardian_consents;
-- drop the nine functions; drop tables media_subjects, media_items,
-- media_albums; delete the site_settings row; drop type album_visibility.
