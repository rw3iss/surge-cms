-- A Contact field only applies to a typed-in answer (text / long text / email /
-- number). Migration 198's label backfill also marked CHOICE and date questions
-- ("Email preferences" as radio buttons → email), and the form editor does not
-- show the field on those types, so an admin could neither see nor clear it.
-- The shared rule (`contactFieldAllowed`, @sitesurge/types utils/formContact.ts)
-- now ignores such a value; this clears it from the data. Idempotent.
UPDATE form_questions
   SET contact_field = NULL
 WHERE contact_field IS NOT NULL
   AND type::text NOT IN ('text', 'textarea', 'email', 'number');

