-- @feature events
-- An optional blurb per ticket type ("Includes dinner", "Members' row"),
-- shown under the tier name on event cards and the event page. Plain text.
ALTER TABLE event_ticket_tiers ADD COLUMN IF NOT EXISTS description TEXT;
