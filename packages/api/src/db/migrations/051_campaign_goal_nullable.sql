-- Make campaigns.goal_amount_cents nullable (open/unlimited fund).
--
-- The canonical schema (schema.sql) has always declared this column
-- nullable — "NULL means open/unlimited fund" — and the admin editor
-- sends null when the operator leaves the goal blank. But databases
-- created from an older schema carried a NOT NULL constraint, so a
-- goal-less campaign save fails with a 23502 not-null violation. Fresh
-- installs already match; this ALTER heals the drift on existing DBs.
--
-- Idempotent: DROP NOT NULL is a no-op if the column is already nullable.

ALTER TABLE campaigns ALTER COLUMN goal_amount_cents DROP NOT NULL;
