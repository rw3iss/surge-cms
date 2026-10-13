-- Membership applications: a tier may REQUIRE APPROVAL. The applicant fills an
-- application form (a Forms entity, or the built-in name/email/phone/occupation
-- form), saves a card (Stripe SetupIntent, no charge), and waits. An admin
-- approves → the Stripe subscription is created and billed then; rejects →
-- nothing is charged. users.approval_status mirrors the latest application
-- (pending / approved / rejected) so the Users table can filter on it.
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS application_form_id UUID REFERENCES forms(id) ON DELETE SET NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status TEXT;

CREATE TABLE IF NOT EXISTS membership_applications (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id            UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
    status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    form_id            UUID REFERENCES forms(id) ON DELETE SET NULL,
    submission_id      UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
    -- Snapshot [{ label, value }] so the review never depends on a form that changed.
    answers            JSONB NOT NULL DEFAULT '[]',
    stripe_customer_id TEXT,
    payment_method_id  TEXT,
    note               TEXT,
    error              TEXT,
    decided_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One open application per member.
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_applications_pending ON membership_applications (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_membership_applications_status ON membership_applications (status, created_at DESC);
