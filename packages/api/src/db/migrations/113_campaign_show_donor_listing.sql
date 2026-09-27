-- Per-campaign "Show donors listing": a Recent Donors list under the raised
-- amount on the campaign page and in {{campaignStatus()}} / {{campaign()}}.
-- Off by default so no existing campaign starts publishing its donors.
-- Each donation's own visibility still applies (public / anonymous / hidden).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS show_donor_listing BOOLEAN NOT NULL DEFAULT false;
