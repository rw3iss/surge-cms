-- @feature shop
--
-- Shop Providers: fulfilment suppliers (Printify, Apliiq, Printful …) managed
-- from Shop → Settings → Providers instead of the plugin system.
--
-- Note this is NOT a secrets store: `config` is plaintext JSONB, exactly as
-- `plugins.config` was. Moving credentials here narrows the audience and gives
-- them a real home; it does not encrypt them. Encryption at rest is separate
-- work — don't let the UI imply otherwise.

CREATE TABLE IF NOT EXISTS shop_providers (
    key                   VARCHAR(32) PRIMARY KEY,
    enabled               BOOLEAN NOT NULL DEFAULT false,
    config                JSONB   NOT NULL DEFAULT '{}'::jsonb,
    auto_sync             BOOLEAN NOT NULL DEFAULT false,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
    last_sync_at          TIMESTAMPTZ,
    last_error            TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inbound webhooks. One row per (provider, event).
--
-- WE own these URLs: they are generated here, shown in our admin, and the
-- operator pastes them into the provider's dashboard.
--
-- `token` is the unguessable path segment. For Apliiq's add-to-store and
-- product-search endpoints it is the ONLY credential — those are unsigned by
-- Apliiq's design — which is why it is 32 random bytes and revocable, and why
-- products created through them land as drafts.
CREATE TABLE IF NOT EXISTS shop_provider_webhooks (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider     VARCHAR(32) NOT NULL,
    event        VARCHAR(64) NOT NULL,
    -- Operator-editable URL segment, so a URL can be matched to whatever a
    -- provider expects and stays stable across a token regeneration.
    path         VARCHAR(64) NOT NULL,
    method       VARCHAR(4)  NOT NULL DEFAULT 'POST',
    -- 'inbound' today. Outbound (us -> provider) is deferred, but the column
    -- means adding it later is not a migration of existing rows.
    direction    VARCHAR(8)  NOT NULL DEFAULT 'inbound',
    token        VARCHAR(64) NOT NULL UNIQUE,
    enabled      BOOLEAN NOT NULL DEFAULT true,
    -- Operator-defined events sit alongside the provider's standard ones. They
    -- get a URL and are logged, but have no handler.
    is_custom    BOOLEAN NOT NULL DEFAULT false,
    label        VARCHAR(120),
    last_seen_at TIMESTAMPTZ,
    last_status  INTEGER,
    last_error   TEXT,
    call_count   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, event),
    UNIQUE (provider, path)
);

CREATE INDEX IF NOT EXISTS idx_shop_provider_webhooks_lookup
    ON shop_provider_webhooks (provider, path);

-- Where a product came from at the provider.
--
-- `external_provider`/`external_id` already exist (migration 075). The design is
-- a distinct thing from the product — Apliiq generates many store products from
-- one design — and it is what dedupe keys on and what the admin deep-links to,
-- so it gets a real column and an index rather than living in JSONB.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS external_design_id VARCHAR(128);

-- Escape hatch for refs a future provider needs that we cannot name yet.
-- Nothing should query on this; promote a key to a real column when it does.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS external_ref JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_shop_products_design
    ON shop_products (external_provider, external_design_id)
    WHERE external_design_id IS NOT NULL;

-- Carry the live Printify credentials across from the plugin system so the
-- integration keeps working through the deploy. Idempotent: re-running never
-- overwrites a config the operator has since edited here.
INSERT INTO shop_providers (key, enabled, config, auto_sync, sync_interval_minutes)
SELECT
    'printify',
    p.enabled,
    p.config,
    COALESCE((p.config ->> 'syncIntervalMinutes')::int, 0) > 0,
    GREATEST(COALESCE((p.config ->> 'syncIntervalMinutes')::int, 60), 1)
FROM plugins p
WHERE p.name = 'printify' AND p.installed = true
ON CONFLICT (key) DO NOTHING;
