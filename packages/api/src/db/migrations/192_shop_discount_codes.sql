-- @feature shop
-- Discount codes: ONE engine for site-wide codes and affiliate codes (an
-- affiliate code = a code with `affiliate_user_id` + `commission_percent`).
-- Usage is COUNTED from paid redemptions, never kept as a mutable counter.
CREATE TABLE IF NOT EXISTS shop_discount_codes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(64) NOT NULL,
    -- percent: `percent` off; fixed: `amount_cents` off (never below zero).
    kind                VARCHAR(10) NOT NULL DEFAULT 'percent' CHECK (kind IN ('percent', 'fixed')),
    percent             NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100),
    amount_cents        INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    active              BOOLEAN NOT NULL DEFAULT true,
    starts_at           TIMESTAMPTZ,
    ends_at             TIMESTAMPTZ,
    max_uses            INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    max_uses_per_user   INTEGER CHECK (max_uses_per_user IS NULL OR max_uses_per_user > 0),
    min_subtotal_cents  INTEGER CHECK (min_subtotal_cents IS NULL OR min_subtotal_cents >= 0),
    -- Who may use it: membership levels and/or roles (empty = anyone).
    allowed_tier_ids    UUID[] NOT NULL DEFAULT '{}',
    allowed_roles       TEXT[] NOT NULL DEFAULT '{}',
    -- Always applies to merchandise; optionally ALSO to event tickets.
    applies_to_tickets  BOOLEAN NOT NULL DEFAULT false,
    -- Affiliate codes: the member credited, and their total share of the
    -- merchandise subtotal (the buyer discount `percent` comes out of it).
    affiliate_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    commission_percent  NUMERIC(5,2) CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100)),
    note                TEXT,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_discount_codes_code ON shop_discount_codes (lower(code)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shop_discount_codes_affiliate ON shop_discount_codes (affiliate_user_id) WHERE affiliate_user_id IS NOT NULL;

-- One row per PAID order that used a code (written by fulfilment).
CREATE TABLE IF NOT EXISTS shop_discount_redemptions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_id               UUID NOT NULL REFERENCES shop_discount_codes(id) ON DELETE CASCADE,
    order_id              UUID NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
    user_id               UUID REFERENCES users(id) ON DELETE SET NULL,
    email                 VARCHAR(255),
    discount_cents        INTEGER NOT NULL DEFAULT 0,
    merch_subtotal_cents  INTEGER NOT NULL DEFAULT 0,
    status                VARCHAR(12) NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'refunded')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS idx_shop_discount_redemptions_code ON shop_discount_redemptions (code_id, status);

ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES shop_discount_codes(id) ON DELETE SET NULL;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS discount_code VARCHAR(64);
