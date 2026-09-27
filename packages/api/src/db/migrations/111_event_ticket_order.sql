-- @feature events
-- Which shop order paid for a ticket (NULL = free). Per ticket, not per
-- registration: one attendee can claim free tickets and buy paid ones for the
-- same date, and the ticket page breaks those down separately. No FK — the
-- shop tables exist only while the shop feature is installed.
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS order_id UUID;
CREATE INDEX IF NOT EXISTS idx_event_tickets_registration ON event_tickets (registration_id);
