-- A member may apply to several PROGRAMS ("Add its role only" levels) at once:
-- at most one pending application per program, and still at most one pending
-- MEMBERSHIP application. `program` is copied from the level when the row is
-- created (a partial index cannot look at subscription_plans).
ALTER TABLE membership_applications ADD COLUMN IF NOT EXISTS program BOOLEAN NOT NULL DEFAULT false;
UPDATE membership_applications a SET program = true
  FROM subscription_plans p WHERE p.id = a.plan_id AND p.role_only = true AND a.program = false;
DROP INDEX IF EXISTS uq_membership_applications_pending;
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_applications_pending_membership
  ON membership_applications (user_id) WHERE status = 'pending' AND program = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_applications_pending_program
  ON membership_applications (user_id, plan_id) WHERE status = 'pending' AND program = true;
