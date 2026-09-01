-- =============================================================================
-- The club's own paperwork stops being the database's business
-- =============================================================================
-- Adam, 2026-09-01: "on the editable registration form, a club admin should
-- still be able to turn off built in and always on form questions."
--
-- Three rows were locked by 20260825140000: `photo_consents`, `gdpr_consent`
-- and `terms`. A locked row cannot be archived and cannot be made optional, and
-- that is a trigger rather than a UI rule so no client can quietly drop it.
--
-- Two of the three are the CLUB's paperwork and the club's call:
--
--   · `terms` — the club's own terms of membership. Whether a registration form
--     asks somebody to accept them is a decision for the committee, not a rule
--     the database should hold them to.
--   · `gdpr_consent` — the data-protection statement. Still the club's legal
--     exposure and still on every form by default; but the club owns its own
--     privacy notice and where it is presented, and a database that refuses to
--     let it move is making a legal decision it is not qualified to make.
--
-- So those two are unlocked. They stay `system` (their key and type are fixed),
-- they stay `required` where they are, and they stay on the form until somebody
-- deliberately retires them.
--
-- THE THIRD IS NOT UNLOCKED. `photo_consents` is the SG-5 question: the four
-- separate permissions the club holds before a child's photograph is used
-- anywhere. Its lock is cited to SAFEGUARDING.md SG-5 and §1.2, and unlocking it
-- is a §6.2 weakening — it needs Adam's signature and a recorded reason, which
-- is not something this migration can supply on his behalf. He can have it in
-- one word; he has not yet said that word about this row specifically.
--
-- Rollback: set `locked = true` on the two rows. Any archive or optional change
-- made in the meantime stands and would need its own decision.
-- =============================================================================

update public.registration_questions
   set locked = false
 where qkey in ('gdpr_consent', 'terms')
   and locked;

comment on column public.registration_questions.locked is
  'The database will not let this question be archived or made optional. Reserved for photo_consents (SG-5); the club''s own terms and its GDPR statement were unlocked on 2026-09-01 because where the club presents its own paperwork is the club''s decision.';
