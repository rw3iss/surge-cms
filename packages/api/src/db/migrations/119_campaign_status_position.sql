-- Where the campaign's status panel (raised/goal + Recent Donors) sits
-- relative to the donation form: 'above' (the previous, default placement)
-- or 'below'. Used by the campaign page and {{campaign()}}.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status_position VARCHAR(8) NOT NULL DEFAULT 'above';
