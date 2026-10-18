-- Re-rank membership levels: "Dev only" levels rank 0 (like Free) and no
-- longer take a paid rank. Same statement as TIER_RANK_SQL in
-- services/subscriptionTiers.ts (re-run on every tier save/delete).
WITH monthly AS (
    SELECT id,
           (COALESCE(is_free, false) OR COALESCE(dev_only, false)) AS free,
           COALESCE(price_cents, 0) * CASE lower(COALESCE("interval", 'month'))
               WHEN 'year' THEN 1.0 / 12 WHEN 'week' THEN 52.0 / 12 WHEN 'day' THEN 365.0 / 12 ELSE 1 END
               / GREATEST(COALESCE(interval_count, 1), 1) AS per_month
      FROM subscription_plans
), ranked AS (
    SELECT id, CASE WHEN free THEN 0 ELSE DENSE_RANK() OVER (PARTITION BY free ORDER BY per_month) END AS rank
      FROM monthly
)
UPDATE subscription_plans p
   SET sort_order = ranked.rank
  FROM ranked
 WHERE ranked.id = p.id AND p.sort_order IS DISTINCT FROM ranked.rank;
