-- The price an applicant chose (e.g. yearly); approval bills it. NULL = the level's default price.
ALTER TABLE membership_applications ADD COLUMN IF NOT EXISTS price_id TEXT;
