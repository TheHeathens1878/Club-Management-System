-- =============================================================================
-- Group scopes (20260824250000)
-- =============================================================================
begin;
select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a3a3a3a3-1111-4111-8111-000000000001', 'gs-admin@test.invalid', '{"full_name": "Ada Admin", "dob": "1980-01-01"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a3a3a3a3-1111-4111-8111-000000000001';
insert into public.resources (id, type, name) values ('b3b3b3b3-1111-4111-8111-000000000051', 'pitch', 'GS Venue Pitch');
insert into public.teams (id, name) values ('8b8b8b8b-1111-4111-8111-000000000001', 'GS Team');

select has_column('public', 'conversations', 'resource_id', 'conversations.resource_id');
select has_column('public', 'conversations', 'scope_label', 'conversations.scope_label');

set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  insert into public.conversations (id, type, title, created_by_person_id, resource_id)
  values ('cccccccc-0000-4000-8000-000000000001', 'group', 'Clubhouse regulars', public.current_person_id(), 'b3b3b3b3-1111-4111-8111-000000000051')
$$, 'a group attaches to a venue');
select lives_ok($$
  insert into public.conversations (id, type, title, created_by_person_id, scope_label)
  values ('cccccccc-0000-4000-8000-000000000002', 'group', 'Minibus rota', public.current_person_id(), 'Minibus')
$$, 'a group attaches to anything via scope_label');
select throws_ok($$
  insert into public.conversations (id, type, title, created_by_person_id, resource_id, team_id)
  values ('cccccccc-0000-4000-8000-000000000003', 'group', 'Both', public.current_person_id(),
          'b3b3b3b3-1111-4111-8111-000000000051', '8b8b8b8b-1111-4111-8111-000000000001')
$$, '23514', null, 'at most one structured attachment');
reset role;

select * from finish();
rollback;
