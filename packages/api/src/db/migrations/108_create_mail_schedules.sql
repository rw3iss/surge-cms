-- @feature mailing_lists

-- Scheduled sends: "mail this template to this list, at this time, this often".
--
-- The schedule OWNS its next run time (`next_run_at`), rather than the
-- scheduler holding timers in memory. node-cron tasks die with the process, so
-- an in-memory schedule silently stops existing after a restart or a deploy —
-- and nobody notices until a newsletter does not arrive. With the next run in
-- the database, a sweeper can simply ask "what is due?" and a restart costs
-- nothing.
--
-- It also makes a missed window recoverable: a server down at 09:00 fires when
-- it comes back rather than skipping the day.

CREATE TABLE IF NOT EXISTS mail_schedules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,

    list_id       UUID NOT NULL REFERENCES mailing_lists(id) ON DELETE CASCADE,
    -- SET NULL, not CASCADE: deleting a template must not silently delete the
    -- schedules that used it. They are disabled by the service instead, so the
    -- operator sees what broke.
    template_id   UUID REFERENCES mail_templates(id) ON DELETE SET NULL,

    -- Per-schedule overrides. NULL = inherit from the template at send time,
    -- so editing the template changes future sends (which is the point of
    -- scheduling a template rather than a copy of one).
    subject       TEXT,
    preheader     TEXT,
    from_name     TEXT,
    from_email    TEXT,
    reply_to      TEXT,
    -- A fully customised body. NULL = use the template's blocks. Stored so a
    -- one-off tweak does not require editing the shared template.
    blocks        JSONB,

    frequency     TEXT NOT NULL CHECK (frequency IN ('once','daily','weekly','monthly','yearly')),
    -- Wall-clock time in `timezone`, NOT an offset from UTC. A newsletter set
    -- for 09:00 must stay at 09:00 across a daylight-saving change, which an
    -- offset cannot express.
    time_of_day   TIME NOT NULL DEFAULT '09:00',
    -- IANA zone. Defaulted by the app from Settings → site defaults, falling
    -- back to America/New_York.
    timezone      TEXT NOT NULL DEFAULT 'America/New_York',
    -- First eligible date, in `timezone`.
    start_date    DATE NOT NULL,

    enabled       BOOLEAN NOT NULL DEFAULT true,

    -- The scheduler's cursor. NULL = nothing further is due (a 'once' schedule
    -- that has fired, or one whose recurrence has been exhausted).
    next_run_at   TIMESTAMPTZ,
    last_run_at   TIMESTAMPTZ,
    -- Outcome of the last attempt, so a silently failing schedule is visible
    -- in the admin instead of just never arriving.
    last_status   TEXT CHECK (last_status IN ('sent','failed','skipped')),
    last_error    TEXT,
    last_job_id   UUID REFERENCES mail_send_jobs(id) ON DELETE SET NULL,
    run_count     INTEGER NOT NULL DEFAULT 0,

    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The sweeper's only query: due, enabled schedules. Partial, because a paused
-- or exhausted schedule is never a candidate and does not belong in the index.
CREATE INDEX IF NOT EXISTS idx_mail_schedules_due
    ON mail_schedules (next_run_at)
    WHERE enabled AND next_run_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mail_schedules_list ON mail_schedules (list_id);

-- Own trigger function, matching the rest of the mailing-list family (030/032)
-- rather than the shared `update_updated_at` used elsewhere in the schema.
CREATE OR REPLACE FUNCTION mail_schedules_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mail_schedules_updated_at ON mail_schedules;
CREATE TRIGGER trg_mail_schedules_updated_at
    BEFORE UPDATE ON mail_schedules
    FOR EACH ROW EXECUTE FUNCTION mail_schedules_updated_at();
