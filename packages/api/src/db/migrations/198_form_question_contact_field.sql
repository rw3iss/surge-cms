-- A form question's CONTACT FIELD: what its answer is for contact purposes
-- (the submitter's email / name / first name / last name / phone). Read by the
-- shared `formContactValues` rule (@sitesurge/types utils/formContact.ts) —
-- mailing-list subscribe, the form email action, replies, and the membership
-- application → /join prefill. NULL = guess from the type + label.
ALTER TABLE form_questions ADD COLUMN IF NOT EXISTS contact_field TEXT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_questions_contact_field_check') THEN
        ALTER TABLE form_questions ADD CONSTRAINT form_questions_contact_field_check
            CHECK (contact_field IS NULL OR contact_field IN ('email', 'name', 'first_name', 'last_name', 'phone'));
    END IF;
END $$;

-- Backfill: mark existing email / name / phone-like questions, the first one
-- per form per field (the same label rule as `guessContactField`).
WITH cleaned AS (
    SELECT id, form_id, "order", type,
           btrim(regexp_replace(regexp_replace(regexp_replace(lower(question), '\(.*?\)', ' ', 'g'),
                 '[_*:?-]+', ' ', 'g'), '\s+', ' ', 'g')) AS l
      FROM form_questions
     WHERE contact_field IS NULL
), labelled AS (
    SELECT id, form_id, "order",
           CASE
               WHEN type = 'email' OR l ~ '\me ?mail\M' THEN 'email'
               WHEN l ~ '\m(phone|mobile|cell|telephone|tel)\M' THEN 'phone'
               WHEN l ~ '\m(first|given|fore) ?name\M' THEN 'first_name'
               WHEN l ~ '\m(last|family|sur) ?name\M' OR l ~ '\msurname\M' THEN 'last_name'
               WHEN l ~ '^(your |full |display )?name$' OR l ~ '\mfull name\M' THEN 'name'
           END AS field
      FROM cleaned
), firsts AS (
    SELECT DISTINCT ON (form_id, field) id, field
      FROM labelled
     WHERE field IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM form_questions f2 WHERE f2.form_id = labelled.form_id AND f2.contact_field = labelled.field)
     ORDER BY form_id, field, "order"
)
UPDATE form_questions fq SET contact_field = firsts.field FROM firsts WHERE fq.id = firsts.id;
