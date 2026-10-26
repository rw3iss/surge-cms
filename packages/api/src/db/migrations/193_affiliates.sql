-- @feature affiliates
-- Affiliate program: Stripe Connect Express accounts, commissions earned on
-- paid orders that used an affiliate code, and payouts (transfers).
CREATE TABLE IF NOT EXISTS affiliate_accounts (
    user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_account_id  VARCHAR(64),
    details_submitted  BOOLEAN NOT NULL DEFAULT false,
    payouts_enabled    BOOLEAN NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS affiliate_payouts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_cents        INTEGER NOT NULL,
    currency            VARCHAR(8) NOT NULL DEFAULT 'usd',
    status              VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
    trigger             VARCHAR(8) NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'auto')),
    stripe_transfer_id  VARCHAR(64),
    error               TEXT,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_user ON affiliate_payouts (user_id, created_at DESC);

-- `commission` rows are earned on payment; a refund adds a `reversal`
-- (negative) row, so a commission already paid out nets against the next
-- payout. Payable once `available_at` (payment + the refund window) passed.
CREATE TABLE IF NOT EXISTS affiliate_earnings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id              UUID NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
    code_id               UUID REFERENCES shop_discount_codes(id) ON DELETE SET NULL,
    kind                  VARCHAR(10) NOT NULL DEFAULT 'commission' CHECK (kind IN ('commission', 'reversal')),
    merch_subtotal_cents  INTEGER NOT NULL DEFAULT 0,
    share_percent         NUMERIC(5,2) NOT NULL DEFAULT 0,
    amount_cents          INTEGER NOT NULL,
    currency              VARCHAR(8) NOT NULL DEFAULT 'usd',
    status                VARCHAR(10) NOT NULL DEFAULT 'earned' CHECK (status IN ('earned', 'paid', 'reversed')),
    available_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payout_id             UUID REFERENCES affiliate_payouts(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, user_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_user ON affiliate_earnings (user_id, status, available_at);
