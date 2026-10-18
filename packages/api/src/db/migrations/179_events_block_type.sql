-- Add the `events` content block (a list of event cards) to both block enums.
--
-- `events` replaces the old single-event `event` block. `event` was declared
-- in the TypeScript BlockType union but never added to these enums, so no
-- `event` row can exist on a stock install; the conversion below is guarded
-- for an install that added the label by hand.
--
-- Core (not feature-tagged): the enum is shared by every block table, and an
-- events block saved while the feature is off must still be storable.
ALTER TYPE block_type ADD VALUE IF NOT EXISTS 'events';
ALTER TYPE content_block_type ADD VALUE IF NOT EXISTS 'events';

-- A new enum value is only usable once committed.
COMMIT;

-- Convert legacy `event` rows: `settings.eventId` → a one-event list binding
-- (`{ binding: { mode: 'list', refs: [eventId] } }`), type → `events`.
DO $$
DECLARE
    has_block BOOLEAN;
    has_content BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'block_type' AND e.enumlabel = 'event'
    ) INTO has_block;
    SELECT EXISTS (
        SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'content_block_type' AND e.enumlabel = 'event'
    ) INTO has_content;

    IF has_block THEN
        UPDATE blocks
           SET type = 'events',
               settings = (COALESCE(settings, '{}'::jsonb) - 'eventId' - 'eventSlug' - 'eventTitle')
                   || CASE WHEN COALESCE(settings->>'eventId', settings->>'eventSlug', '') <> ''
                           THEN jsonb_build_object('binding', jsonb_build_object('mode', 'list',
                                'refs', jsonb_build_array(COALESCE(NULLIF(settings->>'eventId', ''), settings->>'eventSlug'))))
                           ELSE '{}'::jsonb END
         WHERE type::text = 'event';
        IF to_regclass('mail_template_blocks') IS NOT NULL THEN
            UPDATE mail_template_blocks
               SET block_type = 'events',
                   settings = (COALESCE(settings, '{}'::jsonb) - 'eventId' - 'eventSlug' - 'eventTitle')
                       || CASE WHEN COALESCE(settings->>'eventId', settings->>'eventSlug', '') <> ''
                               THEN jsonb_build_object('binding', jsonb_build_object('mode', 'list',
                                    'refs', jsonb_build_array(COALESCE(NULLIF(settings->>'eventId', ''), settings->>'eventSlug'))))
                               ELSE '{}'::jsonb END
             WHERE block_type::text = 'event';
        END IF;
        IF to_regclass('content_block_template_blocks') IS NOT NULL THEN
            UPDATE content_block_template_blocks
               SET block_type = 'events',
                   settings = (COALESCE(settings, '{}'::jsonb) - 'eventId' - 'eventSlug' - 'eventTitle')
                       || CASE WHEN COALESCE(settings->>'eventId', settings->>'eventSlug', '') <> ''
                               THEN jsonb_build_object('binding', jsonb_build_object('mode', 'list',
                                    'refs', jsonb_build_array(COALESCE(NULLIF(settings->>'eventId', ''), settings->>'eventSlug'))))
                               ELSE '{}'::jsonb END
             WHERE block_type::text = 'event';
        END IF;
    END IF;

    IF has_content THEN
        UPDATE post_content_blocks
           SET type = 'events',
               data = (COALESCE(data, '{}'::jsonb) - 'eventId' - 'eventSlug' - 'eventTitle')
                   || CASE WHEN COALESCE(data->>'eventId', data->>'eventSlug', '') <> ''
                           THEN jsonb_build_object('binding', jsonb_build_object('mode', 'list',
                                'refs', jsonb_build_array(COALESCE(NULLIF(data->>'eventId', ''), data->>'eventSlug'))))
                           ELSE '{}'::jsonb END
         WHERE type::text = 'event';
    END IF;
END $$;
