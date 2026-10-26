-- "Add its role only" approval mode for a membership level (a PROGRAM, e.g.
-- Affiliate / Contributor): approving an application adds the level's role to
-- the member's ADDITIONAL roles and leaves their membership + billing alone.
-- Such a level always requires approval and takes no card / shows no price.
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS role_only BOOLEAN NOT NULL DEFAULT false;
