-- Per-breakpoint style overrides for saved block-style TEMPLATES.
--
-- Per-block overrides ride inside the existing `style` JSONB bag on
-- blocks/post_content_blocks/mail_template_blocks (no schema change needed).
-- Block-style templates, however, store each style prop in a dedicated column,
-- so they need a JSONB column to hold the `{ [breakpointId]: { prop: value } }`
-- override map. Nullable (no NOT NULL) so the columnar create/update path can
-- pass NULL when a template has no responsive overrides.

ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS breakpoints JSONB;
