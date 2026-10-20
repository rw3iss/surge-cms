-- Block style templates: the `order` style property (position among siblings,
-- any integer, per breakpoint). Per-block styles keep it in their `style` JSONB;
-- a saved style TEMPLATE stores each property in its own column, so it gets one.
-- (`order` is a reserved word — hence style_order.)
ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS style_order TEXT;
