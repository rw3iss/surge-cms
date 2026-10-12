-- @feature events
-- Event access: who may SEE an event and who may REGISTER (separately), per
-- event ('inherit' = Settings → Events), plus an optional subscription tier
-- required to buy a given ticket type. Levels compare with tier ranks (see
-- services/access/level.ts): public -1, members 0, tier = its rank.

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS view_access         TEXT NOT NULL DEFAULT 'inherit',
    ADD COLUMN IF NOT EXISTS view_min_tier_id    UUID REFERENCES subscription_plans(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS register_access     TEXT NOT NULL DEFAULT 'inherit',
    ADD COLUMN IF NOT EXISTS register_min_tier_id UUID REFERENCES subscription_plans(id) ON DELETE SET NULL;

DO $$ BEGIN
    ALTER TABLE events ADD CONSTRAINT events_view_access_chk CHECK (view_access IN ('inherit','public','members','tier'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE events ADD CONSTRAINT events_register_access_chk CHECK (register_access IN ('inherit','public','members','tier'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE event_ticket_tiers
    ADD COLUMN IF NOT EXISTS required_tier_id UUID REFERENCES subscription_plans(id) ON DELETE SET NULL;
