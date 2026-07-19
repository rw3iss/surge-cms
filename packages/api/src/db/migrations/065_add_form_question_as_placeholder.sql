-- Text-type fields: use the question text as the input placeholder and hide
-- the visible label. Off by default.
ALTER TABLE form_questions ADD COLUMN IF NOT EXISTS question_as_placeholder BOOLEAN NOT NULL DEFAULT false;
