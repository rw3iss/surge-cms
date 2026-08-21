-- @feature events
--
-- Extends the base events tables (091) into the full coordination system:
-- recurrence, per-date exceptions, attendee registration and tiered ticketing.
--
-- Occurrence identity is (event_id, occurrence_date). A recurring event is ONE
-- row plus a rule, so registrations and ticket inventory must be keyed per
-- occurrence — otherwise week 3 of a weekly series would share attendees and
-- capacity with week 1.

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS timezone                VARCHAR(64),
    -- NULL = does not repeat. Small subset of iCal RRULE; see shared/utils/recurrence.ts
    ADD COLUMN IF NOT EXISTS recurrence_rule         VARCHAR(255),
    -- NULL with a rule set = repeats indefinitely (expansion is window-bounded).
    ADD COLUMN IF NOT EXISTS recurrence_until        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS registration_enabled    BOOLEAN NOT NULL DEFAULT false,
    -- Which fields the attendee must supply, e.g. ["name","email","phone"].
    ADD COLUMN IF NOT EXISTS registration_fields     JSONB NOT NULL DEFAULT '["name","email"]'::jsonb,
    ADD COLUMN IF NOT EXISTS show_registrant_count   BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ticketing_enabled       BOOLEAN NOT NULL DEFAULT false,
    -- Free-form per-event config that doesn't warrant a column.
    ADD COLUMN IF NOT EXISTS metadata                JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Recurring series are queried by "does this rule produce anything in range",
-- which starts from a rule-is-not-null scan.
CREATE INDEX IF NOT EXISTS idx_events_recurring
    ON events (recurrence_rule) WHERE recurrence_rule IS NOT NULL;

-- ─── Per-date exceptions to a series ──────────────────────────────
CREATE TABLE IF NOT EXISTS event_occurrence_overrides (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    -- The date this exception applies to, as produced by the expander.
    occurrence_date     DATE NOT NULL,
    status              VARCHAR(20) CHECK (status IN ('cancelled', 'moved')),
    starts_at_override  TIMESTAMPTZ,
    ends_at_override    TIMESTAMPTZ,
    title_override      VARCHAR(255),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One exception per date. Re-cancelling a date updates rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_override_unique
    ON event_occurrence_overrides (event_id, occurrence_date);

-- ─── Ticket tiers ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_ticket_tiers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL DEFAULT 'Default Ticket Price',
    -- Integer minor units, matching the shop. 0 is legitimate: a free tier with
    -- a quantity cap is how you run a limited free event.
    price_cents         INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    currency            VARCHAR(3) NOT NULL DEFAULT 'USD',
    -- NULL = unlimited.
    quantity_available  INTEGER CHECK (quantity_available IS NULL OR quantity_available >= 0),
    position            INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_tiers_event ON event_ticket_tiers (event_id, position);

-- ─── Registrations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_registrations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    -- Which occurrence of a series this is for.
    occurrence_date     DATE NOT NULL,
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    email               VARCHAR(255) NOT NULL,
    name                VARCHAR(255),
    phone               VARCHAR(255),
    -- Any additional configured fields.
    fields              JSONB NOT NULL DEFAULT '{}'::jsonb,
    status              VARCHAR(20) NOT NULL DEFAULT 'registered'
                        CHECK (status IN ('registered', 'cancelled', 'waitlist')),
    -- Set when the registration came through a paid checkout.
    order_id            UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One registration per person per occurrence — a double submit updates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_registration_unique
    ON event_registrations (event_id, occurrence_date, LOWER(email));
CREATE INDEX IF NOT EXISTS idx_event_registrations_event
    ON event_registrations (event_id, occurrence_date);

-- ─── Issued tickets ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_tickets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id     UUID NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
    tier_id             UUID REFERENCES event_ticket_tiers(id) ON DELETE SET NULL,
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    occurrence_date     DATE NOT NULL,
    -- Human-quotable code printed on the confirmation email.
    code                VARCHAR(32) NOT NULL UNIQUE,
    status              VARCHAR(20) NOT NULL DEFAULT 'valid'
                        CHECK (status IN ('valid', 'refunded', 'checked_in', 'cancelled')),
    -- What was ACTUALLY charged, captured at purchase: a later tier price
    -- change must not rewrite history on an issued ticket.
    price_cents_paid    INTEGER NOT NULL DEFAULT 0,
    currency            VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_tickets_event
    ON event_tickets (event_id, occurrence_date);
CREATE INDEX IF NOT EXISTS idx_event_tickets_tier ON event_tickets (tier_id);
CREATE INDEX IF NOT EXISTS idx_event_tickets_registration ON event_tickets (registration_id);
