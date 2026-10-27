/**
 * membershipApplications — tiers that REQUIRE APPROVAL.
 *
 * The applicant answers the tier's application form (a Forms entity, or the
 * built-in Name / Email / Phone / Occupation form), saves a card (no charge),
 * and waits. An admin reviews: approve → the Stripe subscription is created and
 * billed now; reject → nothing is charged.
 *
 *   POST /payments/membership/apply/submit   step 1, answers (signed in or not) — the team is emailed now
 *   POST /payments/membership/apply/card     step 2, signed in: claim + save the card (no charge)
 *   POST /payments/membership/apply          both in one call (SDK cms.payments.applyMembership)
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
    /** What the answer is (email / name / phone …), per the form's Contact field
     *  rule at submit time — `applicantName` reads it. Absent on older rows. */
    field?: import('../../utils/formContact').FormContactField;
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
    /** Null until the applicant creates their account (submitted signed out). */
    userId: string | null;
    /** The email given in the application (or the account's). */
    contactEmail: string | null;
    user: { id: string; email: string; displayName: string; handle: string | null; } | null;
    tierId: string;
    tierName: string;
    /** The level hides its price: no card is taken; approval makes an offer the member pays for later. */
    tierHidePrice?: boolean;
    /** The level is a program ("Add its role only"): approval adds its role, no membership change. */
    tierRoleOnly?: boolean;
    /** The role a program approval adds. */
    tierRole?: string | null;
    /** Account-less application: the account that already uses its email, if any (admin can link it). */
    matchedAccount?: { id: string; email: string; displayName: string; emailVerified: boolean; } | null;
    /** When the approved member started (paid for) the level. */
    activatedAt?: string | null;
    status: MembershipApplicationStatus;
    formId: string | null;
    formTitle: string | null;
    submissionId: string | null;
    answers: MembershipApplicationAnswer[];
    /** The saved card (charged only on approval). */
    card: { brand: string; last4: string; } | null;
    /** What approval will charge: the price the applicant chose (else the level's default). Single-application reads only. */
    price?: { priceId: string; amount: number; currency: string; interval: string; intervalCount: number; } | null;
    /** A "hide price" approval (offer) ends at this time; null = no end. */
    offerExpiresAt?: string | null;
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
    priceId?: string;
    /** The tier's form: answers by question id. Built-in form: by field id (name/email/phone/occupation). */
    answers: Array<{ questionId: string; value: unknown; }>;
    /** A card confirmed with a SetupIntent (`membershipCardSetup`); charged only on approval. */
    paymentMethodId: string;
}

/** POST /payments/membership/apply/submit — step 1, the answers only. */
export interface MembershipApplySubmitBody {
    tierId: string;
    /** The chosen price (one of the level's `prices`); omitted = the default. */
    priceId?: string;
    answers: Array<{ questionId: string; value: unknown; }>;
    /** Honeypot — a hidden field people never fill. When set, nothing is stored or sent. */
    website?: string;
}

export interface MembershipApplySubmitResponse {
    application: MembershipApplyResponse['application'];
    /** Signed handle to claim an application submitted while signed out (null when signed in). */
    token: string | null;
}

/** POST /payments/membership/apply/card — step 2, signed in. */
export interface MembershipApplyCardBody {
    applicationId: string;
    /** From the submit response, when it was submitted signed out. */
    token?: string | null;
    paymentMethodId: string;
}

export interface MembershipApplyResponse {
    application: { id: string; tierId: string; tierName: string; status: MembershipApplicationStatus; createdAt: string; };
}

/** Approved, not started: the member chooses billing and pays to start the level. */
export interface MembershipApprovedOffer {
    applicationId: string;
    tierId: string;
    tierName: string;
    approvedAt: string | null;
}

/** A member's own open (pending) application, on tier lists + access state. */
export interface MembershipPendingApplication {
    id: string;
    tierId: string;
    tierName: string;
    createdAt: string;
    /** The card is saved (needed before it can be approved). */
    hasCard: boolean;
    /** A "hide price" level: no card is asked — billing is chosen after approval. */
    noCard?: boolean;
}

export interface MembershipApplicationsListQuery {
    status?: MembershipApplicationStatus;
    userId?: string;
    /** Only applications submitted before the applicant created an account. */
    withoutAccount?: boolean;
    page?: number;
    limit?: number;
}

export interface MembershipApplicationsSummaryResponse {
    pending: number;
    /** Pending applications submitted before the applicant created an account. */
    withoutAccount: number;
}

export interface MembershipApplicationDecisionBody { note?: string; }

// ─── Programs (Profile → Membership → Programs) ──────────────────────

/**
 * One program ("Add its role only" level) the member holds or applied to.
 * `member` = holds its role; else the latest application's state
 * (`withdrawn` also covers a program the member left).
 */
export interface MembershipProgramStatus {
    tierId: string;
    name: string;
    slug: string | null;
    /** Markdown, as on the level cards. */
    description: string | null;
    role: string | null;
    status: 'member' | 'pending' | 'rejected' | 'withdrawn';
    applicationId: string | null;
    appliedAt: string | null;
    decidedAt: string | null;
}

/** GET /payments/membership/programs. */
export type MembershipProgramsResponse = MembershipProgramStatus[];

/** POST /payments/membership/apply/withdraw — none = the pending MEMBERSHIP application. */
export interface MembershipApplyWithdrawBody {
    applicationId?: string | null;
}
