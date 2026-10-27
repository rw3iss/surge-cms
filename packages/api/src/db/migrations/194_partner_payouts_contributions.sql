-- PARTNER payouts shared by every paid program (affiliates, contributors):
-- the Stripe Connect Express account per user and the payout transfers. These
-- tables were created by the affiliates feature (193); they become core so the
-- contributor program works without the shop/affiliates — IF NOT EXISTS keeps
-- an existing install's rows.
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
-- Which program a payout pays (each program pays its own earnings).
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'affiliate';

-- CONTRIBUTOR compensation: one earning per approved contributed post.
-- Payable after `available_at` (approval + the holding period); an admin may
-- change the amount or revoke it until it is paid.
CREATE TABLE IF NOT EXISTS contribution_earnings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id       UUID REFERENCES posts(id) ON DELETE SET NULL,
    post_title    TEXT,
    amount_cents  INTEGER NOT NULL,
    currency      VARCHAR(8) NOT NULL DEFAULT 'usd',
    status        VARCHAR(10) NOT NULL DEFAULT 'earned' CHECK (status IN ('earned', 'paid', 'revoked')),
    available_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payout_id     UUID REFERENCES affiliate_payouts(id) ON DELETE SET NULL,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contribution_earnings_post ON contribution_earnings (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contribution_earnings_user ON contribution_earnings (user_id, status, available_at);

-- The shared Connect webhook secret moves to `partner_settings` (affiliate
-- settings are removed with the affiliates feature).
INSERT INTO site_settings (key, value)
SELECT 'partner_settings', jsonb_build_object('connectWebhookSecret', value->>'connectWebhookSecret')
  FROM site_settings WHERE key = 'affiliate_settings' AND value ? 'connectWebhookSecret'
ON CONFLICT (key) DO NOTHING;

-- Partners land on Profile → Partner Program.
UPDATE roles SET login_route = 'profile?tab=partners' WHERE login_route = 'profile?tab=affiliate';
