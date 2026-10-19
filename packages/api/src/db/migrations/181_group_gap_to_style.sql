-- Group block: the slot gap moves from the group's own `settings.gap` to the
-- block STYLE's Gap (`style.gap`), so it can differ per breakpoint like every
-- other style property. Copies a set settings.gap into a flat style that has no
-- gap yet, then drops the setting. A style that is only a template reference
-- (`{ "id": … }`) is left alone (the renderer still reads settings.gap there).
-- Idempotent: a second run finds no group with settings.gap to move.

UPDATE blocks
   SET style = CASE
           WHEN COALESCE(style->>'gap', '') = '' THEN COALESCE(style, '{}'::jsonb) || jsonb_build_object('gap', settings->>'gap')
           ELSE style
       END,
       settings = settings - 'gap'
 WHERE type::text = 'group'
   AND settings ? 'gap'
   AND NOT (COALESCE(style, '{}'::jsonb) ? 'id' AND COALESCE(style->>'gap', '') = '');

-- The two feature-owned block tables may not exist on an install without
-- those features — touch them only when present.
DO $$
BEGIN
    IF to_regclass('public.mail_template_blocks') IS NOT NULL THEN
        UPDATE mail_template_blocks
           SET style = CASE
                   WHEN COALESCE(style->>'gap', '') = '' THEN COALESCE(style, '{}'::jsonb) || jsonb_build_object('gap', settings->>'gap')
                   ELSE style
               END,
               settings = settings - 'gap'
         WHERE block_type::text = 'group'
           AND settings ? 'gap'
           AND NOT (COALESCE(style, '{}'::jsonb) ? 'id' AND COALESCE(style->>'gap', '') = '');
    END IF;
    IF to_regclass('public.content_block_template_blocks') IS NOT NULL THEN
        UPDATE content_block_template_blocks
           SET style = CASE
                   WHEN COALESCE(style->>'gap', '') = '' THEN COALESCE(style, '{}'::jsonb) || jsonb_build_object('gap', settings->>'gap')
                   ELSE style
               END,
               settings = settings - 'gap'
         WHERE block_type::text = 'group'
           AND settings ? 'gap'
           AND NOT (COALESCE(style, '{}'::jsonb) ? 'id' AND COALESCE(style->>'gap', '') = '');
    END IF;
END $$;
