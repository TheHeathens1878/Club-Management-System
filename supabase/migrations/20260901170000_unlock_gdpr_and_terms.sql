-- =============================================================================
-- The club decides what it asks; the database keeps the one question it must
-- =============================================================================
-- Adam, 2026-09-01: "on the editable registration form, a club admin should
-- still be able to turn off built in and always on form questions."
--
-- 20260825140000 built two locks and this migration loosens both, keeping the
-- one that SAFEGUARDING.md actually names.
--
-- LOCK 1 — a `system` row could not be ARCHIVED at all. That conflates two
-- different things. "Built in" means the key and the type are fixed: an
-- emergency contact is three fields and cannot become a text box, because the
-- screen renders it by name. Whether the club ASKS it is a different question
-- and not the database's business. A club that does not collect kit sizes
-- should be able to stop asking for one without a migration.
--
--   So: a system row keeps its key, its type and its system-ness, and may now
--   be retired like any other question.
--
-- LOCK 2 — the three `locked` rows could not be archived, made optional, or
-- unlocked. Two of those three are the CLUB's own paperwork:
--
--   · `terms` — the club's terms of membership. Whether a form asks somebody to
--     accept them is a committee decision.
--   · `gdpr_consent` — the data-protection statement. Still the club's legal
--     exposure, and still on every form until somebody deliberately retires it;
--     but the club owns its own privacy notice and where it is presented, and a
--     database that refuses to let it move is making a legal decision it is not
--     qualified to make.
--
-- THE THIRD DOES NOT MOVE. `photo_consents` is the SG-5 question — the four
-- separate permissions the club holds before a child's photograph is used
-- anywhere. Its lock is cited to SAFEGUARDING.md SG-5 and §1.2, and lifting it
-- is a §6.2 weakening: it wants Adam's signature and a recorded reason, and
-- "turn off built in and always on form questions" is not yet that signature
-- about that row. So the guard stops naming `locked` in general and names
-- `photo_consents` in particular, which is what it always meant.
--
-- Rollback: restore the guard from 20260825140000 and set `locked = true` on
-- the two rows. Anything archived in the meantime stays archived; bringing a
-- question back is a decision of its own.
-- =============================================================================

create or replace function public.registration_questions_guard()
  returns trigger
  language plpgsql
as $function$
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
    if not new.system then
      raise exception 'registration_questions: % cannot stop being a built-in question', old.qkey
        using errcode = 'P0001';
    end if;
    -- Archiving is deliberately NOT refused here any more: what is built in is
    -- how the question is rendered, not whether the club asks it.
  end if;

  -- The SG-5 question, by name. It is the only one the database insists on, and
  -- saying so here means a future migration that unlocks a row cannot loosen
  -- this one by accident.
  if old.qkey = 'photo_consents' then
    if new.archived_at is not null and old.archived_at is null then
      raise exception 'registration_questions: % is required on every registration and cannot be archived [SAFEGUARDING.md SG-5]', old.qkey
        using errcode = 'P0001';
    end if;
    if not new.required then
      raise exception 'registration_questions: % is required on every registration and cannot be made optional [SAFEGUARDING.md SG-5]', old.qkey
        using errcode = 'P0001';
    end if;
    if old.locked and not new.locked then
      raise exception 'registration_questions: % cannot be unlocked [SAFEGUARDING.md SG-5, §6.2]', old.qkey
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$function$;

comment on function public.registration_questions_guard() is
  'A built-in question keeps its key, its type and its built-in-ness, and may be retired by the club. photo_consents (SG-5) may not be archived, made optional or unlocked by anybody.';

update public.registration_questions
   set locked = false
 where qkey in ('gdpr_consent', 'terms')
   and locked;

comment on column public.registration_questions.locked is
  'The database will not let this question be archived or made optional. Reserved for photo_consents (SG-5); the club''s own terms and its GDPR statement were unlocked on 2026-09-01 because where the club presents its own paperwork is the club''s decision.';
