-- A retired question stops being owed (2026-09-02).
--
-- Adam: "I need the ability to hide questions on the form. For example, I
-- don't need Player Photo and Proof of identity for this season, but I will
-- do next season."
--
-- The hiding already exists: Registrations → Form retires any question but
-- the SG-5 photo permissions (20260901170000), the wizard renders only live
-- rows, and Restore brings a question back next season. What did NOT follow
-- the retirement was the nag: `needs_id_document()` answered from the
-- person's record alone, so the "still owes the club: proof of identity"
-- line on Register a player kept demanding a document the club had stopped
-- collecting.
--
-- So: while the `id_document` question is retired, nobody needs an identity
-- document. The permission check stays first — an unauthorised caller still
-- gets the refusal, never an answer. Restoring the question restores every
-- nag exactly as it was, because nothing about the person was touched.
--
-- Restated from the LIVE definition (pg_get_functiondef, 2026-09-02).

create or replace function public.needs_id_document(p_person_id uuid)
  returns boolean
  language plpgsql stable security definer
  set search_path = public
as $function$
declare
  v_verified boolean;
begin
  if not (public.can_act_for(p_person_id) or public.is_club_admin()) then
    raise exception 'needs_id_document: you may only ask about yourself or a child you are the guardian of'
      using errcode = '42501';
  end if;

  -- The club has retired the Proof of identity question for now (the form
  -- builder's Retire, guard 20260901170000). While it is retired the club is
  -- not collecting documents, so no one is asked for one — here, on the
  -- person cards, or as the wizard's mandatory upload.
  if exists (
    select 1
      from public.registration_questions q
     where q.qkey = 'id_document'
       and q.archived_at is not null
  ) then
    return false;
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
$function$;
