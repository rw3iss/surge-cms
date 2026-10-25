-- Form question SECTIONS (headings that group questions, one level deep).
-- `forms.sections` holds the section list ({ id, title, description, align,
-- position }); a question points at one with `section_id`. A question's
-- `order` stays one sequence across the whole form (display order).
ALTER TABLE forms ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE form_questions ADD COLUMN IF NOT EXISTS section_id TEXT;
