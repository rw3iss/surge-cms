-- Content-block templates: preview-sample record ids. Editing a template in the
-- admin loads these records so its blocks' {{entity.field}} resolve against real
-- data. Empty/NULL = auto-pick (single → first record; list → first N).
ALTER TABLE content_block_templates ADD COLUMN IF NOT EXISTS sample_record_ids TEXT[];
