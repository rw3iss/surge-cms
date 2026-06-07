-- Add per-page "show title" toggle.
--
-- When false, the public DynamicPage renderer skips the auto-printed
-- <h1> page title and lets the content blocks alone speak for the
-- page (typical use: a hero block IS the headline).
--
-- Default true so existing pages keep their current behavior — the
-- title still renders above the content blocks unless the operator
-- explicitly turns it off.

ALTER TABLE pages ADD COLUMN IF NOT EXISTS show_title BOOLEAN NOT NULL DEFAULT true;
