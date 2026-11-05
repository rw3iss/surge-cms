-- Social analytics: our own daily store of each connected account's numbers.
-- No platform keeps long history for us, so collectors snapshot every day and
-- the dashboard reads only these tables (plan:
-- docs/plans/2026-11-04-social-analytics-research.md §6).
-- `platform` is TEXT, not the social_platform enum: collectors (Threads) may
-- exist for platforms that are not feed providers.

-- One row per account per day: the "now" values (followers, totals).
CREATE TABLE IF NOT EXISTS social_account_snapshots (
    platform     TEXT NOT NULL,
    date         DATE NOT NULL,
    followers    BIGINT,
    following    BIGINT,
    posts_count  BIGINT,
    total_views  BIGINT,
    total_likes  BIGINT,
    raw          JSONB NOT NULL DEFAULT '{}'::jsonb,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (platform, date)
);

-- Platform daily series (views, watch time, subscribers gained…). Rewritten
-- for the last few days on each run because platforms revise recent days.
-- dimension '' = the account total; 'video:<id>' etc. for breakdowns.
CREATE TABLE IF NOT EXISTS social_account_daily (
    platform     TEXT NOT NULL,
    date         DATE NOT NULL,
    metric       TEXT NOT NULL,
    dimension    TEXT NOT NULL DEFAULT '',
    value        DOUBLE PRECISION NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (platform, date, metric, dimension)
);
CREATE INDEX IF NOT EXISTS social_account_daily_metric_idx ON social_account_daily (platform, metric, date);

-- A post's lifetime (cumulative) numbers as of a day: daily for its first
-- 90 days, weekly after. NULL = the platform does not give that number.
CREATE TABLE IF NOT EXISTS social_post_metrics (
    social_post_id  UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    views           BIGINT,
    likes           BIGINT,
    comments        BIGINT,
    shares          BIGINT,
    saves           BIGINT,
    watch_time_s    DOUBLE PRECISION,
    avg_watch_s     DOUBLE PRECISION,
    completion_rate DOUBLE PRECISION,
    reach           BIGINT,
    impressions     BIGINT,
    clicks          BIGINT,
    raw             JSONB NOT NULL DEFAULT '{}'::jsonb,
    collected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (social_post_id, date)
);
CREATE INDEX IF NOT EXISTS social_post_metrics_date_idx ON social_post_metrics (date);

-- One row per collector run: last success, errors and warnings for the admin.
CREATE TABLE IF NOT EXISTS social_analytics_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform    TEXT NOT NULL,
    trigger     TEXT NOT NULL DEFAULT 'cron',
    status      TEXT NOT NULL DEFAULT 'running',
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    counts      JSONB NOT NULL DEFAULT '{}'::jsonb,
    warnings    JSONB NOT NULL DEFAULT '[]'::jsonb,
    error       TEXT
);
CREATE INDEX IF NOT EXISTS social_analytics_runs_platform_idx ON social_analytics_runs (platform, started_at DESC);
