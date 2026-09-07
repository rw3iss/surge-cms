-- Component JS: an optional client module for a block template.
--
-- Stored in the DATABASE rather than on disk, deliberately. Settings →
-- Backup & Restore is a pg_dump of the database only — uploaded files are
-- explicitly NOT covered — so a filesystem-backed script would vanish on a
-- restore while every block referencing it kept rendering. It also keeps
-- Docker / npm-consumer installs working without a writable directory, and
-- avoids needing shared storage across instances.
--
-- Served as a real same-origin module (GET /components/:id/client.js), which
-- is what keeps CSP at `script-src 'self'` — inline <script> and inline
-- handlers are both blocked, by design.
ALTER TABLE content_block_templates
    ADD COLUMN IF NOT EXISTS script TEXT,
    -- Lets an operator disable a misbehaving component's JS without deleting
    -- the code they are still debugging.
    ADD COLUMN IF NOT EXISTS script_enabled BOOLEAN NOT NULL DEFAULT true;
