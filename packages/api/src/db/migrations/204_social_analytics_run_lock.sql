-- Social analytics: at most ONE running collector run per platform.
-- The runner used to check "is one running?" and then insert — two callers
-- (the daily cron and "Collect now", or two cluster processes) could both
-- pass the check and collect the same platform at the same time. The runner
-- now inserts with ON CONFLICT DO NOTHING against this index.

-- Runs left 'running' by a crashed process can never finish: close them first,
-- and keep only the newest of any duplicates so the unique index can be built.
UPDATE social_analytics_runs
   SET status = 'failed', finished_at = COALESCE(finished_at, NOW()), error = COALESCE(error, 'The run did not finish (the process stopped).')
 WHERE status = 'running' AND started_at < NOW() - INTERVAL '30 minutes';

UPDATE social_analytics_runs r
   SET status = 'failed', finished_at = COALESCE(finished_at, NOW()), error = COALESCE(error, 'Replaced by a newer run.')
 WHERE r.status = 'running'
   AND EXISTS (SELECT 1 FROM social_analytics_runs n
                WHERE n.platform = r.platform AND n.status = 'running' AND (n.started_at, n.id) > (r.started_at, r.id));

CREATE UNIQUE INDEX IF NOT EXISTS social_analytics_runs_one_running
    ON social_analytics_runs (platform) WHERE status = 'running';

-- The digest cron fails digests stuck in 'generating' (a process that stopped mid-build).
CREATE INDEX IF NOT EXISTS social_analytics_digests_status_idx
    ON social_analytics_digests (status) WHERE status = 'generating';
