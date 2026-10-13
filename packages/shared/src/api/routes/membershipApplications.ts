/**
 * membershipApplications — tiers that REQUIRE APPROVAL.
 *
 * The applicant answers the tier's application form (a Forms entity, or the
 * built-in Name / Email / Phone / Occupation form), saves a card (no charge),
 * and waits. An admin reviews: approve → the Stripe subscription is created and
 * billed now; reject → nothing is charged.
 *
 *   POST /payments/membership/apply          member applies (SDK cms.payments.applyMembership)
 *   GET  /membership-applications             admin list (?status=pending)
 *   GET  /membership-applications/summary     { pending } for the Users header
 *   GET  /membership-applications/:id         one application (review modal)
 *   POST /membership-applications/:id/approve
 *   POST /membership-applications/:id/reject
 */

export type MembershipApplicationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** One answer, labelled — a snapshot taken when the member applied. */
export interface MembershipApplicationAnswer {
    label: string;
    value: string;
}

/** The built-in application form's field ids (used when a tier has no form). */
export const DEFAULT_APPLICATION_FIELDS = [
    { id: 'name', label: 'Name', type: 'text', required: true, },
    { id: 'email', label: 'Email', type: 'email', required: true, },
    { id: 'phone', label: 'Phone number', type: 'phone', required: true, },
    { id: 'occupation', label: 'Occupation', type: 'text', required: true, },
] as const;

export interface MembershipApplication {
    id: string;
    userId: string;
    user: { id: string; email: string; displayName: string; handle: string | null; } | null;
    tierId: string;
    tierName: string;
    status: MembershipApplicationStatus;
    formId: string | null;
    formTitle: string | null;
    submissionId: string | null;
    answers: MembershipApplicationAnswer[];
    /** The saved card (charged only on approval). */
    card: { brand: string; last4: string; } | null;
    note: string | null;
    /** Last approval error (e.g. the card was declined); the application stays pending. */
    error: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    createdAt: string;
}

/** POST /payments/membership/apply */
export interface MembershipApplyBody {
    tierId: string;
    /** The tier's form: answers by question id. Built-in form: by field id (name/email/phone/occupation). */
    answers: Array<{ questionId: string; value: unknown; }>;
    /** A card confirmed with a SetupIntent (`membershipCardSetup`); charged only on approval. */
    paymentMethodId: string;
}

export interface MembershipApplyResponse {
    application: { id: string; tierId: string; tierName: string; status: MembershipApplicationStatus; createdAt: string; };
}

/** A member's own open (pending) application, on tier lists + access state. */
export interface MembershipPendingApplication {
    id: string;
    tierId: string;
    tierName: string;
    createdAt: string;
}

export interface MembershipApplicationsListQuery {
    status?: MembershipApplicationStatus;
    userId?: string;
    page?: number;
    limit?: number;
}

export interface MembershipApplicationsSummaryResponse { pending: number; }

export interface MembershipApplicationDecisionBody { note?: string; }
