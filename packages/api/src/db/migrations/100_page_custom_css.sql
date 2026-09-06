-- Per-page CSS overrides.
--
-- Rendered after the page's own styles, so a page can restyle template-owned
-- markup (the built-in shop's title and sidebar, say) without every such knob
-- becoming its own database column and admin field.
--
-- NULL/'' means no override, so existing pages are untouched. The value is
-- operator-authored CSS and is injected into a <style> element scoped to the
-- page wrapper — never executed, and never interpolated into HTML where a
-- </style> could break out (see the escaping in pageCustomCss()).
ALTER TABLE pages ADD COLUMN IF NOT EXISTS custom_css TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS custom_css TEXT;
