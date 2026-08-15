-- @feature contacts
-- CRM contacts table, adopted by the `contact` core entity type
-- (entities/coreDescriptors.ts → contactDescriptor). Column names are the
-- snake_case of the descriptor's camelCase field keys so the generic entity
-- repo reads/writes them (firstName→first_name, streetAddress1→street_address1,
-- timeZone→time_zone, …). id/created_by/created_at/updated_at are the standard
-- entity columns. No slug/status/search_vector: the type is hasSlug=false,
-- hasStatus=false, and searches via per-field ILIKE (not tsvector).
--
-- `user_id` links a contact to a registered user. It is NULL on import and is
-- set only when a contact is matched/linked to a user (on first login or from
-- a profile save). ON DELETE SET NULL so removing a user unlinks, not deletes.

CREATE TABLE IF NOT EXISTS ce_contact (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    email VARCHAR(255),
    mobile_phone VARCHAR(255),
    primary_phone VARCHAR(255),
    street_address1 VARCHAR(255),
    street_address2 VARCHAR(255),
    city VARCHAR(255),
    zip VARCHAR(255),
    state VARCHAR(255),
    country VARCHAR(255),
    time_zone VARCHAR(255),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive email lookup (registration match by email) + link lookups.
CREATE INDEX IF NOT EXISTS idx_ce_contact_email_lower ON ce_contact (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_ce_contact_user_id ON ce_contact (user_id);
CREATE INDEX IF NOT EXISTS idx_ce_contact_last_name ON ce_contact (last_name);

-- Standard updated_at trigger (same shared function the base tables use).
DROP TRIGGER IF EXISTS update_ce_contact_updated_at ON ce_contact;
CREATE TRIGGER update_ce_contact_updated_at
    BEFORE UPDATE ON ce_contact
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
