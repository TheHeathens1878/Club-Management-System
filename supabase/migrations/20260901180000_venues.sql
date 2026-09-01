-- =============================================================================
-- Venues: the place a pitch belongs to (Adam, 2026-09-01)
-- =============================================================================
-- "Create venue management, not just pitch management. Each venue (e.g. AoM
--  Sports Club) should have a group for coaches and all coaches whose teams
--  play at that venue are auto-added."
--
-- This migration is the first half — the place. The coaches' group is
-- 20260901190000, exactly as messaging (20260823210000) came before the team
-- rooms that sync themselves (20260823220000).
--
-- WHAT A VENUE WAS UNTIL TODAY
--   A prefix on a pitch's name. `resources` holds every bookable thing the
--   club owns (P1.5) and a pitch is named "Ashton Park – Pitch 2 (Grosvenor
--   Road)"; `apps/web/src/lib/pitch-venue.ts` splits that string on an EN DASH
--   to group the pitch pickers by ground, and 20260824460000 hung a postal
--   `address` off each pitch so a home fixture's maps link had somewhere to
--   point. It worked, and it is why the club's five grounds have never needed
--   a table — but a naming convention cannot carry notes, cannot be renamed
--   without renaming five pitches, cannot be retired, and above all cannot own
--   anything. A coaches' group has to hang off something with an id.
--
-- SO: `venues` is that something, and `resources.venue_id` is the link. The
--   column is NULLABLE and nothing is required to use it: the function room,
--   and any pitch an admin has not placed, simply has no venue. Names are left
--   exactly as they are — "Ashton Park – Pitch 2 (Grosvenor Road)" stays that
--   string, every pitch picker, calendar filter and maps link keeps working,
--   and `splitVenue()` keeps agreeing with the new table because the backfill
--   below IS `splitVenue()`, written in SQL. That is the additive rule in
--   PLAN.md §2.5 taken seriously: nothing is renamed, moved or dropped.
--
-- ADDRESSES
--   A venue carries the ground's address; a pitch keeps its own. They are not
--   the same fact and prod proves it — the two Ashton Park pitches sit on
--   Dumber Lane and Grosvenor Road respectively, two entrances to one park.
--   The backfill seeds the venue address from its lowest-sorted pitch and
--   changes no pitch address at all, so every existing maps link is untouched.
--
-- NO DELETE, DELIBERATELY
--   There is no delete policy and no delete grant. A venue is retired with
--   `active = false`, the way a pitch is (`/pitches/manage` has never offered
--   a delete either). 20260901190000 hangs a conversation off a venue and a
--   conversation is never destroyed (SG-2), so a venue that can be deleted is
--   a venue that can orphan a room full of messages. Retiring keeps the room,
--   the history and the address.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS y (one new table, policies in
-- this file); data touched: creates one venues row per distinct pitch-name
-- prefix and stamps resources.venue_id on the pitches that produced it —
-- additive, nothing renamed or deleted; rollback: §6.
-- =============================================================================


-- =============================================================================
-- 1. venues
-- =============================================================================

create table public.venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Street + postcode, same shape and same 300-character ceiling as
  -- resources.address (20260824460000) so the two can be swapped in a label.
  address     text check (address is null or char_length(address) between 1 and 300),
  -- Anything the club needs the coaches and the ground staff to know: gate
  -- codes, parking, which changing rooms, who holds the key.
  notes       text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint venues_name_not_blank check (btrim(name) <> '')
);

-- One "Ashton Park", however it is typed. Same rule teams already live under
-- (teams_name_idx), and the thing that makes the backfill below re-runnable.
create unique index venues_name_idx on public.venues (lower(name));
create index venues_active_idx on public.venues (active, sort_order);

create trigger trg_venues_updated
  before update on public.venues
  for each row execute function public.set_updated_at();

comment on table public.venues is
  'A ground the club plays at: a name, an address, and the pitches on it. Pitches point here through resources.venue_id; 20260901190000 hangs the venue''s coaches group off it.';
comment on column public.venues.address is
  'The ground''s postal address. A pitch may still carry its own (two entrances to one park); the pitch wins where it has one.';
comment on column public.venues.notes is
  'Gate codes, parking, changing rooms — what a coach arriving for the first time needs.';
comment on column public.venues.active is
  'False retires the venue. Rows are never deleted: 20260901190000 attaches a conversation, and a conversation is never destroyed (SAFEGUARDING.md SG-2).';


-- =============================================================================
-- 2. resources.venue_id — the link
-- =============================================================================
-- `on delete set null` is unreachable in practice (nothing may delete a venue,
-- §1) and is the honest default anyway: losing the ground must never take the
-- pitch, its bookings or its fixtures with it.

alter table public.resources
  add column if not exists venue_id uuid references public.venues (id) on delete set null;

create index if not exists resources_venue_idx
  on public.resources (venue_id) where venue_id is not null;

comment on column public.resources.venue_id is
  'The venue this pitch (or room) is on. Nullable: a resource an admin has not placed simply has no venue. The name is unchanged — "Venue – Pitch N" is still the name.';


-- =============================================================================
-- 3. BACKFILL — splitVenue(), in SQL
-- =============================================================================
-- `apps/web/src/lib/pitch-venue.ts`: the separator is space, EN DASH (U+2013),
-- space, and a name without it is its own venue rather than an error. The web
-- convention and this table must not disagree on day one, so the same rule is
-- applied here — with one deliberate difference: a resource WITHOUT the
-- separator is left unplaced rather than made a venue of one. "Main Function
-- Room" is not a ground, and an admin who wants the clubhouse on a venue can
-- say so on the venue page in ten seconds.
--
-- chr(8211) rather than a literal EN DASH: this file's encoding then cannot
-- change the meaning of the migration.

do $$
declare
  v_sep constant text := ' ' || chr(8211) || ' ';
  v record;
begin
  for v in
    select btrim(split_part(r.name, v_sep, 1))          as venue_name,
           min(r.sort_order)                            as sort_order,
           -- The address of the lowest-sorted pitch that has one. Prod's two
           -- Ashton Park pitches disagree (Dumber Lane / Grosvenor Road);
           -- picking the first is a starting point an admin corrects, and the
           -- pitches keep their own addresses either way.
           (array_agg(r.address order by r.sort_order, r.name)
              filter (where r.address is not null))[1]  as address
      from public.resources r
     where r.type = 'pitch'
       and position(v_sep in r.name) > 0
       and btrim(split_part(r.name, v_sep, 1)) <> ''
     group by 1
     order by 2
  loop
    insert into public.venues (name, address, sort_order)
    values (v.venue_name, v.address, v.sort_order)
    on conflict do nothing;

    update public.resources r
       set venue_id = (select id from public.venues x where lower(x.name) = lower(v.venue_name))
     where r.type = 'pitch'
       and r.venue_id is null
       and btrim(split_part(r.name, v_sep, 1)) = v.venue_name;
  end loop;
end $$;


-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- =============================================================================
-- Deliberately the same shape as `resources` (20260823100000), because a venue
-- is read in exactly the places a pitch is: a parent following a maps link to
-- Saturday's fixture needs the ground's address, and only the club changes it.
--
-- `venues_public_read` is the one policy NOT scoped to a role, for the reason
-- P1.1 taught: the role helpers have EXECUTE revoked from anon by name, so an
-- unscoped admin policy would turn every anon read into "permission denied for
-- function" instead of simply returning no row.
--
-- There is no DELETE policy and no DELETE grant. See §1.

alter table public.venues enable row level security;

create policy "venues_public_read" on public.venues
  for select
  using (active = true);

create policy "venues_admin_read" on public.venues
  for select
  to authenticated
  using (public.is_club_admin());

create policy "venues_admin_insert" on public.venues
  for insert
  to authenticated
  with check (public.is_club_admin());

create policy "venues_admin_update" on public.venues
  for update
  to authenticated
  using (public.is_club_admin())
  with check (public.is_club_admin());


-- =============================================================================
-- 5. GRANTS
-- =============================================================================
-- Mirrors resources: anon may read (the public hire and fixture pages name the
-- ground), authenticated writes are decided by the policies above, and nobody
-- gets DELETE or TRUNCATE — not even service_role, which would otherwise walk
-- straight past the policies.

revoke all privileges on public.venues from anon, authenticated, service_role;

grant select                  on public.venues to anon;
grant select, insert, update  on public.venues to authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- 6. ROLLBACK (documented, not executed)
-- =============================================================================
-- Must run BEFORE 20260901190000's rollback is undone (that migration puts a
-- venue_id on conversations and an FK on this table). As postgres:
--
--   alter table public.resources drop column venue_id;
--   drop table public.venues;        -- takes its policies and indexes with it
--
-- Pitch names, pitch addresses, bookings and fixtures are untouched by this
-- migration, so there is nothing else to put back.
