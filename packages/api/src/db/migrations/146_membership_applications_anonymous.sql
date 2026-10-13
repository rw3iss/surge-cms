-- A membership application can be SUBMITTED before the applicant has an account
-- (the team calls them right away); the account + card attach it later.
ALTER TABLE membership_applications ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE membership_applications ADD COLUMN IF NOT EXISTS contact_email TEXT;
