-- @feature events
-- Text shown INSTEAD of the location on the site (the event editor's "Set
-- text"); the map and "View map" keep using `location` + its point.
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_label TEXT;

-- The seeded "Event Card" entity template prints the location: switch it to
-- the DISPLAYED text (label when set). Only that exact snippet in that one
-- template — an operator's own edits elsewhere are untouched.
UPDATE content_block_template_blocks b
   SET settings = jsonb_set(b.settings, '{content}',
                            to_jsonb(replace(b.settings->>'content',
                                             '{{ if event.location }}<p class="ss-event-card__meta">{{ event.location }}</p>{{ endif }}',
                                             '{{ if event.locationText }}<p class="ss-event-card__meta">{{ event.locationText }}</p>{{ endif }}')))
  FROM content_block_templates t
 WHERE b.template_id = t.id
   AND t.entity_type_key = 'event'
   AND t.name = 'Event Card'
   AND b.settings->>'content' LIKE '%{{ event.location }}%';
