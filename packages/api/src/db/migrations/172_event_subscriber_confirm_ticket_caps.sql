-- @feature events
-- 1) Double opt-in for anonymous "notify me" subscriptions. A stranger could
--    sign any address up to every future announcement; a subscription now
--    counts only once its owner confirms by email (or it was made signed in).
--    Existing rows are grandfathered as confirmed.
ALTER TABLE event_subscribers
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

UPDATE event_subscribers SET confirmed_at = created_at WHERE confirmed_at IS NULL;

-- 2) Per-buyer cap on a ticket type (NULL = no cap beyond the per-line max).
--    Stops one email claiming a whole free allocation.
ALTER TABLE event_ticket_tiers
    ADD COLUMN IF NOT EXISTS max_per_order INTEGER
        CHECK (max_per_order IS NULL OR max_per_order > 0);

-- 3) Check-in time, set by staff from the ticket page (status → checked_in).
ALTER TABLE event_tickets
    ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_event_registrations_email_lower
    ON event_registrations (event_id, occurrence_date, lower(email));
