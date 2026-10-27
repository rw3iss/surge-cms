-- @feature events
-- An event's location as an exact POINT (picked on the map in the event
-- editor) next to its text, and whether the event page shows a map of it.
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION;
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION;
ALTER TABLE events ADD COLUMN IF NOT EXISTS show_map BOOLEAN NOT NULL DEFAULT false;
