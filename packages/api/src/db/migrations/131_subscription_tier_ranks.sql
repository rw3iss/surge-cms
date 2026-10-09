-- Subscription tier RANK (subscription_plans.sort_order) is now automatic:
-- the free tier (is_free) = 0; paid tiers 1, 2, … by price, cheapest
-- first (compared per month, so a yearly price is divided by 12; equal prices
-- share a rank). The post gate ("this tier or higher") and the entity query
-- filter `subscription > 1` both read this rank. services/subscriptionTiers.ts
-- (TIER_RANK_SQL) re-runs the same statement on every tier save/delete.
WITH monthly AS (
    SELECT id,
           COALESCE(is_free, false) AS free,
           COALESCE(price_cents, 0) * CASE lower(COALESCE("interval", 'month'))
               WHEN 'year' THEN 1.0 / 12 WHEN 'week' THEN 52.0 / 12 WHEN 'day' THEN 365.0 / 12 ELSE 1 END AS per_month
      FROM subscription_plans
), ranked AS (
    SELECT id, CASE WHEN free THEN 0 ELSE DENSE_RANK() OVER (PARTITION BY free ORDER BY per_month) END AS rank
      FROM monthly
)
UPDATE subscription_plans p
   SET sort_order = ranked.rank
  FROM ranked
 WHERE ranked.id = p.id AND p.sort_order IS DISTINCT FROM ranked.rank;
