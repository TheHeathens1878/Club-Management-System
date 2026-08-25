-- =============================================================================
-- registration_builder — an editable registration form, a player photo and ID
-- (2026-08-25)
-- =============================================================================
-- Adam: "create an editable registration form with the ability to upload a
-- photo of the player (which will automatically become the avatar for the
-- contact). They also need the ability to upload ID (passport, birth cert
-- etc), mandatory if we haven't certified that we have previously seen it
-- (tick box by admin). Max 5Mb and ID automatically deleted after 3 years. We
-- should be able to drag questions around the form. As a default, need photo
-- permissions and GDPR."
--
-- Four things, and the safeguarding position of each:
--
--   1. `registration_questions` — the form, as data. The v1 keys in
--      docs/specs/P2.2-registration-flow.md §2 become seeded SYSTEM rows: the
--      screen still renders the hard-coded blocks for those (an emergency
--      contact is three fields and a medical block is not a text box), and the
--      table decides the ORDER, the WORDING and whether each is required. A
--      club administrator may add their own questions, which land in
--      `form.custom.<qkey>`.
--
--      Three rows are LOCKED — `photo_consents`, `gdpr_consent`, `terms` —
--      because Adam asked for photo permissions and GDPR "as a default": a
--      locked row cannot be archived and cannot be made optional. That is a
--      trigger, not a UI rule, so no client and no Edge Function can quietly
--      drop the consent question off the form (SAFEGUARDING §1.2).
--
--   2. `people.photo_path` — the player photo, which is the contact's avatar.
--      Written only through `set_person_photo()`, which refuses a path that
--      does not live under that person's own folder. Without that check any
--      guardian could point their child's avatar at another child's file.
--
--   3. `identity_documents` — passports and birth certificates. These are
--      children's identity documents, so:
--        · the uploader (the person or their active guardian) can see THAT a
--          document was uploaded, and nothing more. The bytes are readable by
--          `club_admin` alone — the storage SELECT policy names only admins.
--        · no UPDATE and no DELETE grants at all (SG-2's shape). A purge is
--          `identity_document_purged()`, service_role only, which nulls the
--          path and stamps `purged_at`; the ROW survives as evidence that ID
--          was seen and when it was destroyed.
--        · `purge_after` defaults to three years from upload, and the
--          `id-docs-purge` Edge Function scheduled at the bottom of this file
--          removes the object and calls that function. Storage limitation
--          (C7) done by a job, not by a promise.
--
--   4. `people.id_verified` — the admin's "we have seen this before" tick.
--      `needs_id_document()` is true when that tick is absent AND no live
--      document exists, and the join screen makes the upload mandatory in
--      exactly that case.
--
-- ROLLBACK (documented, not executed):
--   select cron.unschedule('id-docs-purge-daily');
--   drop policy person_photos_upload  on storage.objects;  -- and the other three
--   delete from storage.buckets where id in ('person-photos','identity-documents')
--     (after emptying them);
--   drop function public.identity_documents_due_purge(),
--        public.identity_document_purged(uuid), public.needs_id_document(uuid),
--        public.set_id_verified(uuid, boolean), public.set_person_photo(uuid, text),
--        public.set_registration_question_order(uuid[]);
--   drop table public.identity_documents;
--   drop table public.registration_questions;
--   alter table public.people drop column photo_path, drop column id_verified,
--     drop column id_verified_at, drop column id_verified_by;
-- =============================================================================


-- =============================================================================
-- 1. registration_questions
-- =============================================================================

create table public.registration_questions (
  id          uuid primary key default gen_random_uuid(),
  qkey        text not null unique,
  label       text not null,
  help_text   text,
  qtype       text not null,
  options     jsonb not null default '[]'::jsonb,
  required    boolean not null default false,
  -- A row the application knows by name: its qkey and qtype are wired into a
  -- rendered block, so neither may change and the row may not be archived.
  system      boolean not null default false,
  -- Stronger still: cannot be archived and cannot be made optional. The three
  -- consent questions Adam asked for as defaults.
  locked      boolean not null default false,
  position    integer not null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint registration_questions_qkey_shape
    check (qkey ~ '^[a-z][a-z0-9_]{1,58}$'),
  constraint registration_questions_label_not_blank
    check (btrim(label) <> ''),
  constraint registration_questions_help_not_blank
    check (help_text is null or btrim(help_text) <> ''),
  constraint registration_questions_qtype_known
    check (qtype in ('short_text', 'long_text', 'select', 'checkbox', 'date',
                     'phone', 'email', 'emergency_contact', 'medical',
                     'kit_size', 'player_photo', 'id_document',
                     'photo_consents', 'gdpr_consent', 'terms')),
  constraint registration_questions_options_is_array
    check (jsonb_typeof(options) = 'array'),
  constraint registration_questions_position_positive
    check ("position" > 0),
  -- A locked question is by definition a system question and is required.
  constraint registration_questions_locked_is_system
    check (not locked or system),
  constraint registration_questions_locked_is_required
    check (not locked or required)
);

comment on table public.registration_questions is
  'The registration form, as data: order, wording and requiredness of every question. System rows map to a rendered block; locked rows (photo consents, GDPR, terms) can be neither archived nor made optional.';
comment on column public.registration_questions.qkey is
  'Stable key. System rows use the v1 form keys from docs/specs/P2.2-registration-flow.md §2; custom rows land in form.custom.<qkey>.';
comment on column public.registration_questions.archived_at is
  'Archived, never deleted — a stored answer keeps its question''s wording.';

create index registration_questions_live_idx
  on public.registration_questions ("position") where archived_at is null;

create trigger trg_registration_questions_updated
  before update on public.registration_questions
  for each row execute function public.set_updated_at();


-- --- the guard ---------------------------------------------------------------
-- Unconditional: a trigger binds `service_role` and the table owner, and a rule
-- enforced only in the builder screen is not enforced (SAFEGUARDING §1.2).

create or replace function public.registration_questions_guard()
  returns trigger
  language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Only a migration seeds a system row. An administrator adding a question
    -- through the builder gets an ordinary one.
    if auth.uid() is not null and (new.system or new.locked) then
      raise exception 'registration_questions: system and locked questions are seeded by a migration, not created through the app'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.system then
    if new.qkey is distinct from old.qkey then
      raise exception 'registration_questions: % is a built-in question — its key cannot change', old.qkey
        using errcode = 'P0001';
    end if;
    if new.qtype is distinct from old.qtype then
      raise exception 'registration_questions: % is a built-in question — its type cannot change', old.qkey
        using errcode = 'P0001';
    end if;
    if new.archived_at is not null and old.archived_at is null then
      raise exception 'registration_questions: % is a built-in question and cannot be archived', old.qkey
        using errcode = 'P0001';
    end if;
    if not new.system then
      raise exception 'registration_questions: % cannot stop being a built-in question', old.qkey
        using errcode = 'P0001';
    end if;
  end if;

  if old.locked then
    if new.archived_at is not null and old.archived_at is null then
      raise exception 'registration_questions: % is required on every registration and cannot be archived [SAFEGUARDING.md SG-5]', old.qkey
        using errcode = 'P0001';
    end if;
    if not new.required then
      raise exception 'registration_questions: % is required on every registration and cannot be made optional [SAFEGUARDING.md SG-5]', old.qkey
        using errcode = 'P0001';
    end if;
    if not new.locked then
      raise exception 'registration_questions: % cannot be unlocked', old.qkey
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_registration_questions_guard
  before insert or update on public.registration_questions
  for each row execute function public.registration_questions_guard();


-- --- the seed ---------------------------------------------------------------
-- The v1 form, in the order the join screen already asks it, plus the four
-- things this migration adds. Wording is editable from the builder; the keys
-- are not.

insert into public.registration_questions
  (qkey, label, help_text, qtype, options, required, system, locked, position)
values
  ('emergency_contact', 'Emergency contact',
   'Someone we can ring on a Saturday morning.',
   'emergency_contact', '[]'::jsonb, true, true, false, 1),

  ('medical', 'Health',
   'Anything the coach should know before the player takes the field.',
   'medical', '[]'::jsonb, false, true, false, 2),

  ('previous_club', 'Previous club', null,
   'short_text', '[]'::jsonb, false, true, false, 3),

  ('preferred_position', 'Preferred position', null,
   'short_text', '[]'::jsonb, false, true, false, 4),

  ('kit_size', 'Kit size', null,
   'kit_size',
   '["5-6 years","7-8 years","9-10 years","11-12 years","13-14 years","Adult S","Adult M","Adult L","Adult XL"]'::jsonb,
   false, true, false, 5),

  ('player_photo', 'Player photo',
   'A head-and-shoulders photo. It becomes the player''s picture in the club''s records. JPEG, PNG, WebP or HEIC, up to 5MB.',
   'player_photo', '[]'::jsonb, false, true, false, 6),

  ('id_document', 'Proof of identity',
   'A passport, birth certificate or driving licence. Required unless the club has already confirmed it has seen it. Held for three years and then destroyed automatically.',
   'id_document', '[]'::jsonb, false, true, false, 7),

  ('photo_consents', 'Photo permissions',
   'Where the club may use photographs of this player. Each is a separate decision and each can be withdrawn at any time.',
   'photo_consents', '[]'::jsonb, true, true, true, 8),

  ('gdpr_consent', 'Data protection',
   'How the club stores and uses this information, and the rights that come with it.',
   'gdpr_consent', '[]'::jsonb, true, true, true, 9),

  ('terms', 'Club terms',
   'Confirm the details are correct and accept the club''s terms.',
   'terms', '[]'::jsonb, true, true, true, 10);


-- --- reordering --------------------------------------------------------------

create or replace function public.set_registration_question_order(p_ids uuid[])
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_id      uuid;
  v_pos     integer := 0;
  v_changed integer := 0;
begin
  if not public.is_club_admin() then
    raise exception 'set_registration_question_order: only a club administrator may reorder the registration form'
      using errcode = '42501';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    raise exception 'set_registration_question_order: give the full list of question ids'
      using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_ids) as t(x)) <> array_length(p_ids, 1) then
    raise exception 'set_registration_question_order: the same question appears twice'
      using errcode = '22023';
  end if;

  foreach v_id in array p_ids loop
    v_pos := v_pos + 1;
    update public.registration_questions
       set "position" = v_pos
     where id = v_id;
    if found then
      v_changed := v_changed + 1;
    end if;
  end loop;

  perform public.write_audit(
    'registration.questions.reordered',
    'registration_questions',
    null,
    jsonb_build_object('questions', v_changed));

  return v_changed;
end;
$$;

comment on function public.set_registration_question_order(uuid[]) is
  'Renumber the registration form 1..n in the order given. club_admin only; audited.';


-- =============================================================================
-- 2. people — the photo and the ID tick
-- =============================================================================

alter table public.people
  add column photo_path      text,
  add column id_verified     boolean not null default false,
  add column id_verified_at  timestamptz,
  add column id_verified_by  uuid references auth.users (id) on delete set null;

comment on column public.people.photo_path is
  'Object path in the private `person-photos` bucket. The contact''s avatar. Written only by set_person_photo().';
comment on column public.people.id_verified is
  'A club administrator has certified that the club has seen this person''s identity document. Turns needs_id_document() off.';


create or replace function public.set_person_photo(p_person_id uuid, p_path text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if p_person_id is null then
    raise exception 'set_person_photo: person is required' using errcode = '22023';
  end if;
  if not (public.can_act_for(p_person_id) or public.is_club_admin()) then
    raise exception 'set_person_photo: you may only set a photo for yourself or a child you are the guardian of'
      using errcode = '42501';
  end if;

  if p_path is not null then
    -- The bucket policy admits an upload under the person's own folder; this is
    -- the same rule, applied to the pointer. Without it a guardian could aim a
    -- child's avatar at somebody else's file.
    if btrim(p_path) = '' or left(p_path, 37) <> p_person_id::text || '/' then
      raise exception 'set_person_photo: the photo must live under this person''s own folder'
        using errcode = '22023';
    end if;
  end if;

  update public.people
     set photo_path = nullif(btrim(coalesce(p_path, '')), '')
   where id = p_person_id;

  -- Never the path: audit rows have a wider readership than the file does.
  perform public.write_audit('people.photo.updated', 'people', p_person_id::text, null);
end;
$$;


create or replace function public.set_id_verified(p_person_id uuid, p_verified boolean)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not public.is_club_admin() then
    raise exception 'set_id_verified: only a club administrator may confirm that the club has seen an identity document'
      using errcode = '42501';
  end if;
  if p_person_id is null or p_verified is null then
    raise exception 'set_id_verified: person and verified are both required' using errcode = '22023';
  end if;

  update public.people
     set id_verified    = p_verified,
         id_verified_at = case when p_verified then now() end,
         id_verified_by = case when p_verified then auth.uid() end
   where id = p_person_id;

  perform public.write_audit('people.id_verified', 'people', p_person_id::text,
                             jsonb_build_object('verified', p_verified));
end;
$$;


create or replace function public.needs_id_document(p_person_id uuid)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_verified boolean;
begin
  if not (public.can_act_for(p_person_id) or public.is_club_admin()) then
    raise exception 'needs_id_document: you may only ask about yourself or a child you are the guardian of'
      using errcode = '42501';
  end if;

  select id_verified into v_verified from public.people where id = p_person_id;
  if v_verified is null then
    -- No such person: fail closed, the same way SG-0 does with an unknown DOB.
    return true;
  end if;
  if v_verified then
    return false;
  end if;

  return not exists (
    select 1 from public.identity_documents d
     where d.person_id = p_person_id
       and d.purged_at is null);
end;
$$;

comment on function public.needs_id_document(uuid) is
  'True when the club has neither certified it has seen this person''s ID nor holds a live identity document for them.';


-- =============================================================================
-- 3. identity_documents
-- =============================================================================

create table public.identity_documents (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.people (id) on delete restrict,
  registration_id uuid references public.registrations (id) on delete set null,
  kind            text not null,
  storage_path    text,
  uploaded_by     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  -- Adam: "ID automatically deleted after 3 years."
  purge_after     date not null default (current_date + interval '3 years')::date,
  purged_at       timestamptz,

  constraint identity_documents_kind_known
    check (kind in ('passport', 'birth_certificate', 'driving_licence', 'other')),
  -- The row outlives the file. A live row must point at one; a purged row
  -- must not.
  constraint identity_documents_path_matches_state
    check ((purged_at is null and storage_path is not null and btrim(storage_path) <> '')
        or (purged_at is not null and storage_path is null))
);

comment on table public.identity_documents is
  'Passports, birth certificates and the like, held for three years then purged by the id-docs-purge job. The uploader sees the row; only a club_admin can read the file.';
comment on column public.identity_documents.purged_at is
  'Set by identity_document_purged() once the object is gone. The row survives as evidence that ID was held and when it was destroyed.';

create index identity_documents_person_idx
  on public.identity_documents (person_id) where purged_at is null;
create index identity_documents_due_idx
  on public.identity_documents (purge_after) where purged_at is null;


-- The SG-2 shape: no hand-editing, no deleting. A purge is a named function.
create trigger trg_identity_documents_deny_hard_delete
  before delete on public.identity_documents
  for each row execute function public.deny_hard_delete();
create trigger trg_identity_documents_deny_truncate
  before truncate on public.identity_documents
  for each statement execute function public.deny_truncate();

-- The only UPDATE this table accepts is the purge itself. A blanket deny would
-- also stop `identity_document_purged()` (a trigger binds the definer too), so
-- the guard names the one legitimate transition and refuses everything else —
-- including any attempt to re-point a live row at another file.
create or replace function public.identity_documents_guard()
  returns trigger
  language plpgsql
as $$
begin
  if old.purged_at is not null then
    raise exception 'identity_documents: a purged document is history and cannot be edited'
      using errcode = 'P0001';
  end if;
  if new.purged_at is null or new.storage_path is not null then
    raise exception 'identity_documents: rows are written once; the only change is the retention purge'
      using errcode = 'P0001';
  end if;
  if new.id              is distinct from old.id
     or new.person_id       is distinct from old.person_id
     or new.registration_id is distinct from old.registration_id
     or new.kind            is distinct from old.kind
     or new.uploaded_by     is distinct from old.uploaded_by
     or new.created_at      is distinct from old.created_at
     or new.purge_after     is distinct from old.purge_after then
    raise exception 'identity_documents: the purge clears the file, it does not rewrite the record'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_identity_documents_guard
  before update on public.identity_documents
  for each row execute function public.identity_documents_guard();


create or replace function public.identity_document_purged(p_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_person uuid;
begin
  if auth.uid() is not null then
    raise exception 'identity_document_purged: the retention job calls this, not a user'
      using errcode = '42501';
  end if;

  update public.identity_documents
     set purged_at    = now(),
         storage_path = null
   where id = p_id
     and purged_at is null
  returning person_id into v_person;

  if v_person is null then
    return;
  end if;

  perform public.write_audit('identity_document.purged', 'identity_documents', p_id::text,
                             jsonb_build_object('person_id', v_person));
end;
$$;


create or replace function public.identity_documents_due_purge()
  returns table (id uuid, person_id uuid, storage_path text)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select d.id, d.person_id, d.storage_path
    from public.identity_documents d
   where d.purged_at is null
     and d.purge_after <= current_date
   order by d.purge_after
   limit 500;
$$;


-- =============================================================================
-- 4. RLS + PRIVILEGES
-- =============================================================================

alter table public.registration_questions enable row level security;
alter table public.identity_documents     enable row level security;

-- The form is not a secret: anyone signed in renders it. Archived rows stay
-- readable to admins so the builder can show what was retired.
create policy "registration_questions_read" on public.registration_questions
  for select to authenticated
  using (archived_at is null or public.is_club_admin());
create policy "registration_questions_admin_insert" on public.registration_questions
  for insert to authenticated
  with check (public.is_club_admin());
create policy "registration_questions_admin_update" on public.registration_questions
  for update to authenticated
  using (public.is_club_admin())
  with check (public.is_club_admin());
-- Deliberately no FOR DELETE policy: questions are archived.

revoke all privileges on public.registration_questions from anon, authenticated, service_role;
grant select, insert, update on public.registration_questions to authenticated;
grant select, insert, update on public.registration_questions to service_role;

-- Identity documents. INSERT by the person or their active guardian (or an
-- admin typing in a paper form); SELECT of the ROW by the same people plus
-- club_admin; no UPDATE, no DELETE, by anybody, through the API.
create policy "identity_documents_insert" on public.identity_documents
  for insert to authenticated
  with check (uploaded_by = auth.uid()
              and purged_at is null
              and (public.can_act_for(person_id) or public.is_club_admin()));
create policy "identity_documents_read" on public.identity_documents
  for select to authenticated
  using (public.can_act_for(person_id) or public.is_club_admin());

revoke all privileges on public.identity_documents from anon, authenticated, service_role;
grant select, insert on public.identity_documents to authenticated;
grant select on public.identity_documents to service_role;   -- the purge goes through the function
revoke update, delete, truncate on public.identity_documents from anon, authenticated, service_role;

revoke all privileges on function public.set_registration_question_order(uuid[]) from public, anon;
grant execute on function public.set_registration_question_order(uuid[]) to authenticated, service_role;
revoke all privileges on function public.set_person_photo(uuid, text) from public, anon;
grant execute on function public.set_person_photo(uuid, text) to authenticated, service_role;
revoke all privileges on function public.set_id_verified(uuid, boolean) from public, anon;
grant execute on function public.set_id_verified(uuid, boolean) to authenticated, service_role;
revoke all privileges on function public.needs_id_document(uuid) from public, anon;
grant execute on function public.needs_id_document(uuid) to authenticated, service_role;
revoke all privileges on function public.identity_document_purged(uuid) from public, anon, authenticated;
grant execute on function public.identity_document_purged(uuid) to service_role;
revoke all privileges on function public.identity_documents_due_purge() from public, anon, authenticated;
grant execute on function public.identity_documents_due_purge() to service_role;
revoke all privileges on function public.registration_questions_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.identity_documents_guard() from public, anon, authenticated, service_role;


-- =============================================================================
-- 5. STORAGE — two private buckets, 5MB each (Adam: "Max 5Mb")
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('person-photos', 'person-photos', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('identity-documents', 'identity-documents', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

-- Both buckets are laid out as <person_id>/<file>. The first path segment is
-- therefore the authorisation question, and a path that is not shaped like one
-- is admitted by nobody rather than raising out of a policy.
create policy "person_photos_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'person-photos'
              and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+'
              and (public.can_act_for((storage.foldername(name))[1]::uuid) or public.is_club_admin()));

create policy "person_photos_read" on storage.objects for select to authenticated
  using (bucket_id = 'person-photos'
         and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+'
         and (public.can_act_for((storage.foldername(name))[1]::uuid) or public.is_club_admin()));

create policy "identity_documents_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'identity-documents'
              and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+'
              and (public.can_act_for((storage.foldername(name))[1]::uuid) or public.is_club_admin()));

-- READ IS ADMIN ONLY, and that asymmetry is the point: these are children's
-- identity documents. A guardian who uploaded one sees their `identity_documents`
-- row (kind, date, purge date) — never the bytes, and never anybody else's.
create policy "identity_documents_admin_read" on storage.objects for select to authenticated
  using (bucket_id = 'identity-documents' and public.is_club_admin());


-- =============================================================================
-- 6. SCHEDULE — the three-year purge
-- =============================================================================
-- Needs `supabase functions deploy id-docs-purge`; until then
-- invoke_edge_function() is a no-op notice, exactly as P2.4 set it up.

select cron.schedule('id-docs-purge-daily', '20 5 * * *',
                     $cron$ select public.invoke_edge_function('id-docs-purge') $cron$);


notify pgrst, 'reload schema';
