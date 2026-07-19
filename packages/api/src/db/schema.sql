-- RW Database Schema
-- PostgreSQL 14+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- USERS & AUTHENTICATION
-- =====================================================

CREATE TYPE user_role AS ENUM ('anonymous', 'member', 'editor', 'admin', 'sysadmin');
CREATE TYPE auth_provider AS ENUM ('patreon', 'email');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255), -- NULL for Patreon-only users
    display_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    role user_role NOT NULL DEFAULT 'member',
    auth_provider auth_provider NOT NULL,
    patreon_id VARCHAR(255) UNIQUE,
    patreon_tier VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_banned BOOLEAN NOT NULL DEFAULT false,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_patreon_id ON users(patreon_id);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(512) UNIQUE NOT NULL,
    refresh_token VARCHAR(512) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(token);
CREATE INDEX idx_user_sessions_refresh_token ON user_sessions(refresh_token);

CREATE TABLE users_banned (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255),
    ip_address INET,
    reason TEXT,
    banned_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX idx_users_banned_email ON users_banned(email);
CREATE INDEX idx_users_banned_ip ON users_banned(ip_address);

CREATE TABLE patreon_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patreon_user_id VARCHAR(255) NOT NULL,
    patron_status VARCHAR(50),
    currently_entitled_tiers JSONB DEFAULT '[]',
    lifetime_support_cents INTEGER DEFAULT 0,
    last_charge_date TIMESTAMPTZ,
    last_charge_status VARCHAR(50),
    pledge_cadence INTEGER,
    raw_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patreon_memberships_user_id ON patreon_memberships(user_id);

-- =====================================================
-- CONTENT MANAGEMENT - PAGES
-- =====================================================

CREATE TYPE page_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    meta_title VARCHAR(255),
    meta_description TEXT,
    meta_keywords TEXT[],
    og_image TEXT,
    status page_status NOT NULL DEFAULT 'draft',
    is_homepage BOOLEAN NOT NULL DEFAULT false,
    show_title BOOLEAN NOT NULL DEFAULT true,
    apply_page_padding BOOLEAN NOT NULL DEFAULT true,
    apply_site_gutter BOOLEAN NOT NULL DEFAULT true,
    header_style VARCHAR(16),
    header_position VARCHAR(16),
    show_in_nav BOOLEAN NOT NULL DEFAULT false,
    nav_order INTEGER NOT NULL DEFAULT 0,
    is_private BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_pages_homepage ON pages(is_homepage) WHERE is_homepage = true;
CREATE INDEX idx_pages_slug ON pages(slug);
CREATE INDEX idx_pages_status ON pages(status);
CREATE INDEX idx_pages_nav ON pages(show_in_nav, nav_order);

-- =====================================================
-- CONTENT MANAGEMENT - BLOCKS
-- =====================================================

CREATE TYPE block_type AS ENUM (
    'rich_text', 'post', 'post_list', 'form', 'image', 'video',
    'gallery', 'social', 'campaign', 'hero', 'html',
    'group', 'group_item'
);

CREATE TABLE blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    parent_block_id UUID REFERENCES blocks(id) ON DELETE CASCADE,
    type block_type NOT NULL,
    title VARCHAR(255),
    content TEXT,
    settings JSONB NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    is_visible BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blocks_page_id ON blocks(page_id);
CREATE INDEX idx_blocks_order ON blocks(page_id, "order");
CREATE INDEX idx_blocks_parent_order ON blocks(parent_block_id, "order");

-- =====================================================
-- CONTENT MANAGEMENT - POSTS (Blog)
-- =====================================================

CREATE TYPE post_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    excerpt TEXT,
    content TEXT, -- Legacy field, content now lives in post_content_blocks
    featured_image TEXT,
    author VARCHAR(255),
    author_id UUID REFERENCES users(id),
    status post_status NOT NULL DEFAULT 'draft',
    is_private BOOLEAN NOT NULL DEFAULT false,
    apply_post_padding BOOLEAN NOT NULL DEFAULT true,
    apply_site_gutter BOOLEAN NOT NULL DEFAULT true,
    header_style VARCHAR(16),
    header_position VARCHAR(16),
    -- Banner image layout: 'standalone' (default) | 'hero' | 'thumbnail'.
    banner_layout VARCHAR(16) NOT NULL DEFAULT 'standalone',
    tags TEXT[] DEFAULT '{}',
    categories TEXT[] DEFAULT '{}',
    meta_title VARCHAR(255),
    meta_description TEXT,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_posts_slug ON posts(slug);
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_posts_published_at ON posts(published_at DESC);
CREATE INDEX idx_posts_author_id ON posts(author_id);

-- =====================================================
-- POST CONTENT BLOCKS
-- =====================================================

CREATE TYPE content_block_type AS ENUM (
    'text', 'social_media', 'image', 'video', 'document', 'url_link',
    'rich_text', 'hero', 'html', 'campaign', 'form', 'post', 'post_list',
    'social_feed', 'gallery', 'carousel', 'spacer'
);

CREATE TABLE post_content_blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    type content_block_type NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    data JSONB NOT NULL DEFAULT '{}', -- Flexible data for each block type
    -- Common metadata extracted for indexing/querying
    provider VARCHAR(50), -- For social_media blocks
    media_url TEXT, -- URL to media file
    file_name VARCHAR(255), -- For document blocks
    file_size INTEGER, -- File size in bytes
    mime_type VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_post_content_blocks_post_id ON post_content_blocks(post_id);
CREATE INDEX idx_post_content_blocks_order ON post_content_blocks(post_id, sort_order);
CREATE INDEX idx_post_content_blocks_type ON post_content_blocks(type);
CREATE INDEX idx_post_content_blocks_provider ON post_content_blocks(provider);

-- =====================================================
-- SOCIAL CONNECTIONS
-- =====================================================

CREATE TYPE connection_provider AS ENUM (
    'instagram', 'facebook', 'tiktok', 'patreon', 'youtube', 'twitter'
);

CREATE TABLE social_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider connection_provider NOT NULL UNIQUE,
    is_connected BOOLEAN NOT NULL DEFAULT false,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    display_name VARCHAR(255), -- Account display name
    account_id VARCHAR(255), -- Provider account/page ID
    credentials JSONB NOT NULL DEFAULT '{}', -- Encrypted API keys, tokens, etc.
    settings JSONB NOT NULL DEFAULT '{}', -- Provider-specific settings
    auto_publish BOOLEAN NOT NULL DEFAULT false,
    auto_publish_count INTEGER, -- NULL means publish all
    sort_order INTEGER NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMPTZ,
    connected_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_social_connections_provider ON social_connections(provider);
CREATE INDEX idx_social_connections_enabled ON social_connections(is_enabled);
CREATE INDEX idx_social_connections_sort ON social_connections(sort_order);
CREATE INDEX idx_posts_tags ON posts USING GIN(tags);
CREATE INDEX idx_posts_categories ON posts USING GIN(categories);

-- =====================================================
-- MEDIA LIBRARY
-- =====================================================

CREATE TABLE media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size INTEGER NOT NULL,
    url TEXT NOT NULL,
    thumbnail_url TEXT,
    alt TEXT,
    caption TEXT,
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_uploaded_by ON media(uploaded_by);
CREATE INDEX idx_media_mime_type ON media(mime_type);
CREATE INDEX idx_media_created_at ON media(created_at DESC);

-- =====================================================
-- SOCIAL MEDIA INTEGRATION
-- =====================================================

CREATE TYPE social_platform AS ENUM (
    'patreon', 'youtube', 'instagram', 'facebook', 'twitter', 'tiktok'
);

CREATE TABLE social_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform social_platform NOT NULL,
    external_id VARCHAR(255) NOT NULL,
    content TEXT,
    media_url TEXT,
    thumbnail_url TEXT,
    author_name VARCHAR(255),
    author_avatar TEXT,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_data JSONB,
    UNIQUE(platform, external_id)
);

CREATE INDEX idx_social_posts_platform ON social_posts(platform);
CREATE INDEX idx_social_posts_published_at ON social_posts(published_at DESC);

-- =====================================================
-- CAMPAIGNS & DONATIONS
-- =====================================================

CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'completed', 'cancelled');
CREATE TYPE donation_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
CREATE TYPE donation_visibility AS ENUM ('public', 'anonymous', 'hidden');

CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT NOT NULL,
    short_description TEXT,
    featured_image TEXT,
    goal_amount_cents INTEGER, -- NULL means open/unlimited fund
    show_raised_amount BOOLEAN NOT NULL DEFAULT true,
    current_amount_cents INTEGER NOT NULL DEFAULT 0,
    status campaign_status NOT NULL DEFAULT 'draft',
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    donor_count INTEGER NOT NULL DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT false,
    -- Which system collects donations for this campaign: 'internal' (Stripe,
    -- default) or 'givebutter' (the GiveButter plugin, when enabled). The
    -- GiveButter numeric id + 6-char widget code are stored when linked/created.
    donation_provider VARCHAR(16) NOT NULL DEFAULT 'internal',
    givebutter_campaign_id BIGINT,
    givebutter_campaign_code VARCHAR(16),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_slug ON campaigns(slug);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_is_published ON campaigns(is_published);

CREATE TABLE donations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    donor_name VARCHAR(255),
    donor_email VARCHAR(255) NOT NULL,
    amount_cents INTEGER NOT NULL,
    message TEXT,
    visibility donation_visibility NOT NULL DEFAULT 'public',
    stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
    stripe_charge_id VARCHAR(255),
    status donation_status NOT NULL DEFAULT 'pending',
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_donations_campaign_id ON donations(campaign_id);
CREATE INDEX idx_donations_user_id ON donations(user_id);
CREATE INDEX idx_donations_status ON donations(status);
CREATE INDEX idx_donations_created_at ON donations(created_at DESC);

-- =====================================================
-- FORMS & QUESTIONNAIRES
-- =====================================================

CREATE TYPE form_status AS ENUM ('draft', 'published', 'closed', 'archived');
CREATE TYPE question_type AS ENUM (
    'radio', 'checkbox', 'text', 'textarea', 'select', 'number', 'email', 'date'
);

CREATE TABLE forms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    status form_status NOT NULL DEFAULT 'draft',
    show_results BOOLEAN NOT NULL DEFAULT false,
    allow_multiple_submissions BOOLEAN NOT NULL DEFAULT false,
    requires_auth BOOLEAN NOT NULL DEFAULT false,
    success_message TEXT,
    submit_button_text VARCHAR(100),
    -- On-submit action + settings (migration 060): submit | subscribe | email.
    action VARCHAR(16) NOT NULL DEFAULT 'submit',
    action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    max_submissions INTEGER,
    submission_count INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE INDEX idx_forms_slug ON forms(slug);
CREATE INDEX idx_forms_status ON forms(status);

CREATE TABLE form_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    type question_type NOT NULL,
    question TEXT NOT NULL,
    description TEXT,
    options TEXT[],
    is_required BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    validation JSONB,
    width VARCHAR(8) NOT NULL DEFAULT 'full',
    placeholder VARCHAR(255),
    question_as_placeholder BOOLEAN NOT NULL DEFAULT false,
    "rows" INTEGER,
    allow_resize BOOLEAN NOT NULL DEFAULT true,
    max_height VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_form_questions_form_id ON form_questions(form_id);
CREATE INDEX idx_form_questions_order ON form_questions(form_id, "order");

CREATE TABLE form_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    answers JSONB NOT NULL,
    -- Per-render idempotency token (migration 060).
    nonce VARCHAR(64),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS form_submissions_form_nonce_uniq
    ON form_submissions (form_id, nonce) WHERE nonce IS NOT NULL;

CREATE INDEX idx_form_submissions_form_id ON form_submissions(form_id);
CREATE INDEX idx_form_submissions_user_id ON form_submissions(user_id);
CREATE INDEX idx_form_submissions_submitted_at ON form_submissions(submitted_at DESC);

-- =====================================================
-- CONTACT MESSAGES
-- =====================================================

CREATE TYPE message_status AS ENUM ('unread', 'read', 'replied', 'archived', 'spam');

CREATE TABLE contact_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    message TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    status message_status NOT NULL DEFAULT 'unread',
    replied_at TIMESTAMPTZ,
    replied_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contact_messages_status ON contact_messages(status);
CREATE INDEX idx_contact_messages_created_at ON contact_messages(created_at DESC);
CREATE INDEX idx_contact_messages_email ON contact_messages(email);

-- =====================================================
-- SITE SETTINGS
-- =====================================================

CREATE TABLE site_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(255) UNIQUE NOT NULL,
    value JSONB NOT NULL,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- FONTS (operator-uploaded font assets)
-- =====================================================

CREATE TABLE fonts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    custom_id VARCHAR(64) NOT NULL UNIQUE,
    original_name VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    format VARCHAR(20) NOT NULL,
    size_bytes INTEGER NOT NULL,
    family_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fonts_custom_id ON fonts(custom_id);
CREATE INDEX idx_fonts_created_at ON fonts(created_at DESC);

-- =====================================================
-- CACHE INVALIDATION TRACKING
-- =====================================================

CREATE TABLE cache_keys (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cache_keys_expires ON cache_keys(expires_at);

-- =====================================================
-- AUDIT LOG
-- =====================================================

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

-- =====================================================
-- API KEYS
-- =====================================================

-- Headless/server-to-server authentication.
-- Plaintext keys are NEVER stored: only sha256(key) lands in key_hash.
-- key_prefix holds the first chars (e.g. 'ssk_a1b2c3d4') for display.

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    key_hash CHAR(64) NOT NULL UNIQUE,
    key_prefix VARCHAR(16) NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{read}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys (key_hash) WHERE revoked_at IS NULL;

-- =====================================================
-- TRIGGERS FOR UPDATED_AT
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_pages_updated_at
    BEFORE UPDATE ON pages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_blocks_updated_at
    BEFORE UPDATE ON blocks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_campaigns_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_forms_updated_at
    BEFORE UPDATE ON forms
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_post_content_blocks_updated_at
    BEFORE UPDATE ON post_content_blocks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_social_connections_updated_at
    BEFORE UPDATE ON social_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_form_questions_updated_at
    BEFORE UPDATE ON form_questions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_patreon_memberships_updated_at
    BEFORE UPDATE ON patreon_memberships
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- TRIGGERS FOR DONATION AGGREGATION
-- =====================================================

CREATE OR REPLACE FUNCTION update_campaign_totals()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'completed' THEN
        UPDATE campaigns
        SET current_amount_cents = current_amount_cents + NEW.amount_cents,
            donor_count = donor_count + 1
        WHERE id = NEW.campaign_id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status != 'completed' AND NEW.status = 'completed' THEN
            UPDATE campaigns
            SET current_amount_cents = current_amount_cents + NEW.amount_cents,
                donor_count = donor_count + 1
            WHERE id = NEW.campaign_id;
        ELSIF OLD.status = 'completed' AND NEW.status = 'refunded' THEN
            UPDATE campaigns
            SET current_amount_cents = current_amount_cents - OLD.amount_cents,
                donor_count = donor_count - 1
            WHERE id = OLD.campaign_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_campaign_totals
    AFTER INSERT OR UPDATE ON donations
    FOR EACH ROW
    WHEN (NEW.campaign_id IS NOT NULL)
    EXECUTE FUNCTION update_campaign_totals();

-- =====================================================
-- TRIGGERS FOR FORM SUBMISSION COUNT
-- =====================================================

CREATE OR REPLACE FUNCTION update_form_submission_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE forms SET submission_count = submission_count + 1 WHERE id = NEW.form_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE forms SET submission_count = submission_count - 1 WHERE id = OLD.form_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_form_submission_count
    AFTER INSERT OR DELETE ON form_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_form_submission_count();

-- =====================================================
-- FULL-TEXT SEARCH INDEXES
-- =====================================================

ALTER TABLE posts ADD COLUMN search_vector tsvector;

CREATE OR REPLACE FUNCTION posts_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.excerpt, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_search_vector_trigger
    BEFORE INSERT OR UPDATE ON posts
    FOR EACH ROW
    EXECUTE FUNCTION posts_search_vector_update();

CREATE INDEX idx_posts_search ON posts USING GIN(search_vector);

ALTER TABLE pages ADD COLUMN search_vector tsvector;

CREATE OR REPLACE FUNCTION pages_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pages_search_vector_trigger
    BEFORE INSERT OR UPDATE ON pages
    FOR EACH ROW
    EXECUTE FUNCTION pages_search_vector_update();

CREATE INDEX idx_pages_search ON pages USING GIN(search_vector);
