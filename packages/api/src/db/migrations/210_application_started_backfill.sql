-- An APPROVED (charged) membership application is STARTED: approval now sets
-- `activated_at` (services/membershipApplications.ts). Before, only a
-- "Hide price" offer bought through the normal change flow set it, so a
-- normal approved application stayed "approved, not started" with no offer
-- expiry — and once that membership lapsed, `approvedOfferFor` showed it again
-- as an open offer, letting the member re-buy an approval level without
-- applying. Backfill: mark as started every approved, unstarted, non-program
-- application whose member got a subscription to that level after applying.
UPDATE membership_applications a
   SET activated_at = COALESCE(a.decided_at, a.updated_at, NOW())
 WHERE a.status = 'approved'
   AND a.activated_at IS NULL
   AND a.program = false
   AND a.user_id IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM subscriptions s
        WHERE s.user_id = a.user_id AND s.plan_id = a.plan_id AND s.created_at >= a.created_at
   );

-- Account-less applications are looked up by email on every verified sign-in
-- (`claimByVerifiedEmail`) and per submit (one pending row per email + level).
CREATE INDEX IF NOT EXISTS idx_membership_applications_contact_email_unclaimed
    ON membership_applications (lower(contact_email))
 WHERE user_id IS NULL;
