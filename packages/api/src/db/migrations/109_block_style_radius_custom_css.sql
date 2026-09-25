-- Border radius + per-block custom CSS on saved block-style templates.
--
-- Per-BLOCK inline styles live in `blocks.style` / `*_blocks.style` JSONB and
-- need no migration; only the saved TEMPLATES in `block_styles` are columnar.
--
-- `custom_css` is TEXT, not a constrained type: it holds whatever the operator
-- writes. It is scoped to the block at render time (selectors are rewritten
-- under the block's own wrapper), so a rule here cannot reach the rest of the
-- page — the storage is deliberately dumb and the safety lives in the renderer.
ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS border_radius VARCHAR(100);
ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS custom_css TEXT;
