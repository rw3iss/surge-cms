/**
 * The registry of every email the CMS can send on its own behalf.
 *
 * ## Why a registry
 *
 * Before this, one email (member verification) was operator-editable and every
 * other one was HTML welded into the service that happened to send it. Adding a
 * customisable email meant inventing storage, a settings shape and an editor
 * again. A feature declares a PURPOSE here instead, and gets the toggle, the
 * block editor, the variable reference and the default template for free.
 *
 * ## What a purpose is (and isn't)
 *
 * A purpose is a *reason to send*, not a template — "the order confirmation the
 * buyer gets", not "this particular HTML". The operator may replace the body,
 * but they cannot invent a new purpose, because something in the code has to
 * decide when to send it and with what context.
 *
 * This is deliberately NOT the same thing as a mailing-list `mail_templates`
 * row. Those are campaigns: listed for bulk sending, chosen by a human at send
 * time. A purpose fires from an event with one recipient and a fixed variable
 * set. Keeping them apart is what stops "Reset password" appearing in the
 * send-to-a-mailing-list picker.
 *
 * ## Defaults
 *
 * `defaultSubject` lives here because it is plain text the client also wants to
 * show. The default BLOCK tree lives server-side (`services/mail/purposeDefaults`)
 * — it needs mail block shapes, and the client never renders one.
 */

/** One `{{ }}` variable a purpose guarantees to its template. */
export interface MailPurposeVariable {
    /** The reference as typed in the template, e.g. `user.name`. */
    name: string;
    description: string;
    /** Shown in the editor's reference list so the shape is obvious. */
    example?: string;
}

export interface MailPurposeMeta {
    key: string;
    label: string;
    description: string;
    /** Feature key gating visibility — the purpose is hidden when it's off. */
    feature: string;
    /**
     * Who receives it. `user` goes to one person the event is about; `admin`
     * goes to the recipients configured in Settings → Notifications. The
     * distinction drives the wording in the editor, and stops an operator
     * expecting a customer address on an internal alert.
     */
    audience: 'user' | 'admin';
    /**
     * Whether the email sends when nothing is configured. Existing behaviour
     * wins: an email the system already sends defaults ON, so adding the
     * registry never silently stops mail an operator relies on.
     */
    defaultEnabled: boolean;
    /**
     * Wording for the enable switch when "Email enabled" is too vague.
     *
     * The switch always means the same thing — may this email be sent at all —
     * but what "sent" involves differs: most purposes fire from an event, while
     * an announcement is triggered by hand. A purpose can say so in its own
     * terms rather than leaving the operator to infer it.
     *
     * It deliberately does NOT mean "use my custom template". Whether the
     * operator's body or the built-in one is used is decided by whether they
     * wrote any blocks, for every purpose alike.
     */
    enabledLabel?: string;
    enabledHelp?: string;
    /**
     * Purposes whose trigger is a judgement call rather than an event offer an
     * "automatically send" switch, defaulting OFF. New-merchandise announcements
     * are the motivating case: the event (a product went live) is not on its own
     * a decision to mail the list.
     */
    supportsAutoSend?: boolean;
    autoSendLabel?: string;
    autoSendHelp?: string;
    defaultSubject: string;
    /** Variables available to this purpose's template, for the editor's list. */
    variables: MailPurposeVariable[];
}

/** Variables every purpose gets, so each entry below lists only its own. */
export const COMMON_MAIL_VARIABLES: MailPurposeVariable[] = [
    { name: 'site.name', description: 'The site name from Settings → General.', example: 'Surge Media', },
    { name: 'site.url', description: 'The public base URL of the site.', example: 'https://example.com', },
];

const USER_VARS: MailPurposeVariable[] = [
    { name: 'user.name', description: "The recipient's display name (may be empty).", example: 'Ada', },
    { name: 'user.email', description: "The recipient's email address.", example: 'ada@example.com', },
];

export const MAIL_PURPOSES: MailPurposeMeta[] = [
    // ── Users ──
    {
        key: 'user_verification',
        label: 'Email verification',
        description: 'Sent to a new member to confirm their email address before they can sign in.',
        feature: 'users',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'Verify your email for {{site.name}}',
        variables: [
            ...USER_VARS,
            { name: 'verification_url', description: 'The one-time link that confirms the address.', example: 'https://example.com/verify?token=…', },
            { name: 'verificationUrl', description: 'camelCase alias of `verification_url`.', },
        ],
    },
    {
        key: 'user_invite',
        label: 'Account invite',
        description: 'Sent when an admin invites someone to create an account (e.g. a brand ambassador). The link expires after 3 days.',
        feature: 'users',
        audience: 'user',
        defaultEnabled: true,
        enabledLabel: 'Invites can be sent',
        defaultSubject: "You're invited to join {{site.name}}",
        variables: [
            ...USER_VARS,
            { name: 'invite_url', description: 'The link that opens the account form.', example: 'https://example.com/invite/…', },
            { name: 'inviteUrl', description: 'camelCase alias of `invite_url`.', },
            { name: 'roles', description: 'The roles the new account gets, by name.', example: 'Ambassador', },
            { name: 'expires_at', description: 'When the link stops working.', example: 'October 16, 2026', },
        ],
    },
    {
        key: 'user_role_added',
        label: 'Role added',
        description: 'Sent to an existing member when an invite gives their account a new role (e.g. Ambassador).',
        feature: 'users',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'New role on {{site.name}}: {{roles}}',
        variables: [
            ...USER_VARS,
            { name: 'roles', description: 'The roles added, by name.', example: 'Ambassador', },
            { name: 'login_url', description: 'The sign-in page.', example: 'https://example.com/login', },
        ],
    },
    {
        key: 'user_password_reset',
        label: 'Password reset',
        description: 'Sent when someone requests a password reset from the login page.',
        feature: 'users',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'Reset your {{site.name}} password',
        variables: [
            ...USER_VARS,
            { name: 'reset_url', description: 'The one-time link that opens the reset form.', example: 'https://example.com/reset-password?token=…', },
            { name: 'resetUrl', description: 'camelCase alias of `reset_url`.', },
            { name: 'expires_in', description: 'How long the link stays valid, in words.', example: '1 hour', },
        ],
    },
    {
        key: 'user_password_changed',
        label: 'Password changed',
        description: "Confirmation sent after a password is successfully reset — the recipient's cue that something is wrong if it wasn't them.",
        feature: 'users',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'Your {{site.name}} password was changed',
        variables: [...USER_VARS,],
    },
    {
        key: 'user_welcome',
        label: 'Welcome email',
        description: 'Sent to a member once their account is active.',
        feature: 'users',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'Welcome to {{site.name}}',
        variables: [...USER_VARS,],
    },
    {
        key: 'user_subscription_changed',
        label: 'Membership changed',
        description: 'Sent to a member when their membership changes — an upgrade, a downgrade, or a cancellation back to the free plan.',
        feature: 'users',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'Your {{site.name}} membership changed',
        variables: [
            ...USER_VARS,
            { name: 'subscription.previous.name', description: 'The plan before the change (or "None").', example: 'Free', },
            { name: 'subscription.previous.price', description: "The previous plan's price.", example: 'Free', },
            { name: 'subscription.current.name', description: 'The plan after the change.', example: 'Subscriber', },
            { name: 'subscription.current.description', description: "The new plan's description.", example: 'Members-only videos and articles.', },
            { name: 'subscription.current.price', description: 'What the new plan costs per period.', example: '9.99 USD', },
            { name: 'subscription.current.frequency', description: 'How often it bills.', example: 'monthly', },
            { name: 'subscription.note', description: 'When the change takes effect, and what happens to the old plan.', example: 'Your membership was upgraded today.', },
        ],
    },
    {
        key: 'membership_application_received',
        label: 'Membership application received',
        description: 'Sent to someone who applies for a membership level that requires approval. The default text depends on where they stand (signed in or not, card needed or not).',
        feature: 'users',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'We received your {{tier.name}} application',
        variables: [
            ...USER_VARS,
            { name: 'tier.name', description: 'The membership level applied for.', example: "Founder's Club", },
            { name: 'application.next', description: 'What the applicant still has to do (plain text).', example: 'Create your account with this email address and add your card.', },
            { name: 'application.claimUrl', description: 'Link to finish the application — only when something is left to do (create the account, add a card); empty otherwise.', example: 'https://example.com/profile?tab=membership&…', },
            { name: 'application.viewUrl', description: 'Signed-in applicants: where they follow their applications (Profile → Membership).', example: 'https://example.com/profile?tab=membership', },
            { name: 'application.program', description: '"yes" for a program ("Add its role only" level).', example: 'yes', },
        ],
    },
    {
        key: 'membership_application_approved',
        label: 'Membership application approved',
        description: 'Sent when an application is approved. For a level that hides its price, approval is an OFFER: the member chooses billing and pays.',
        feature: 'users',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: "You're approved for {{tier.name}}",
        variables: [
            ...USER_VARS,
            { name: 'tier.name', description: 'The membership level.', example: "Founder's Club", },
            { name: 'application.claimUrl', description: 'Link to start the membership (offers only).', example: 'https://example.com/profile?tab=membership&…', },
            { name: 'application.offer', description: '"yes" when approval is an offer (nothing charged yet), else empty.', example: 'yes', },
            { name: 'application.offerExpires', description: 'When the offer ends (offers only).', example: 'November 17, 2026', },
            { name: 'application.program', description: '"yes" for a program ("Add its role only"): the role was added, no membership change.', example: 'yes', },
            { name: 'application.invited', description: '"yes" when the applicant had no account and was sent an invitation to create one (programs).', example: 'yes', },
            { name: 'note', description: "The reviewer's note (may be empty).", example: 'Welcome aboard!', },
        ],
    },
    {
        key: 'membership_application_rejected',
        label: 'Membership application not approved',
        description: 'Sent when an application is rejected. Nothing is charged.',
        feature: 'users',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'Your {{tier.name}} application',
        variables: [
            { name: 'application.card', description: '"yes" when the applicant saved a card for a PRICED level (the "not charged" line).', example: 'yes', },
            ...USER_VARS,
            { name: 'tier.name', description: 'The membership level.', example: "Founder's Club", },
            { name: 'reason', description: "The rejection reason from the Reject dialog (may be empty). Same as `note`.", example: 'We are full this season.', },
            { name: 'note', description: "The reviewer's reason (may be empty).", example: 'We are full this season.', },
        ],
    },
    {
        key: 'user_signup_admin',
        label: 'New signup (staff alert)',
        description: 'Internal alert when a member registers. Goes to the addresses in Settings → Notifications.',
        feature: 'users',
        audience: 'admin',
        defaultEnabled: true,
        defaultSubject: 'New signup on {{site.name}}',
        variables: [...USER_VARS,],
    },

    // ── Shop ──
    {
        key: 'shop_order_customer',
        label: 'Order confirmation (customer)',
        description: "Sent to the buyer when their order is paid.",
        feature: 'shop',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'Your {{site.name}} order {{order.number}}',
        variables: [
            { name: 'order.number', description: 'The customer-facing order number.', example: 'SM-1042', },
            { name: 'order.total', description: 'Order total, formatted.', example: '$64.98', },
            { name: 'order.status', description: 'Fulfilment status at send time.', example: 'paid', },
            { name: 'order.itemsHtml', description: 'A rendered table of the ordered line items.', },
            { name: 'order.url', description: 'Link to the order confirmation page.', },
            { name: 'customer.name', description: "The buyer's name.", },
            { name: 'customer.email', description: "The buyer's email.", },
        ],
    },
    {
        key: 'shop_order_admin',
        label: 'New order (staff alert)',
        description: 'Internal alert when an order is placed. Goes to the addresses in Settings → Notifications.',
        feature: 'shop',
        audience: 'admin',
        defaultEnabled: true,
        defaultSubject: 'New order {{order.number}} on {{site.name}}',
        variables: [
            { name: 'order.number', description: 'The customer-facing order number.', },
            { name: 'order.total', description: 'Order total, formatted.', },
            { name: 'order.itemsHtml', description: 'A rendered table of the ordered line items.', },
            { name: 'order.adminUrl', description: 'Link to the order in the admin.', },
            { name: 'customer.name', description: "The buyer's name.", },
            { name: 'customer.email', description: "The buyer's email.", },
        ],
    },
    {
        key: 'shop_order_shipped',
        label: 'Order shipped',
        description: 'Sent to the buyer when tracking is added to their order.',
        feature: 'shop',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'Your {{site.name}} order {{order.number}} has shipped',
        variables: [
            { name: 'order.number', description: 'The customer-facing order number.', },
            { name: 'order.trackingNumber', description: 'Carrier tracking number, when known.', },
            { name: 'order.trackingUrl', description: 'Carrier tracking link, when known.', },
            { name: 'order.carrier', description: 'Carrier name, when known.', },
            { name: 'order.trackingHtml', description: 'Every parcel as a linked line ("OnTrac · 1LSC…"), with shipped/delivered dates.', },
            { name: 'customer.name', description: "The buyer's name.", },
        ],
    },
    {
        key: 'shop_new_merchandise',
        label: 'New merchandise announcement',
        description: 'Announces newly published products to a mailing list.',
        feature: 'shop',
        audience: 'user',
        // The template exists so it can be written ahead of time; sending is a
        // separate, explicit decision (see supportsAutoSend).
        defaultEnabled: true,
        enabledLabel: 'Announcements can be sent',
        enabledHelp:
            'Announcements are sent from the Shop dashboard, or hourly when automatic sending is on '
            + 'below. Turning this off stops both — the Shop dashboard will refuse to send.',
        supportsAutoSend: true,
        autoSendLabel: 'Automatically send when new merchandise goes live',
        autoSendHelp:
            'Off by default. A product going live is not on its own a decision to mail your list — '
            + 'leave this off and send the announcement yourself from the Shop dashboard, or turn it on '
            + 'to have newly published products announced automatically (batched hourly, one email).',
        defaultSubject: 'New at {{site.name}}',
        variables: [
            ...USER_VARS,
            { name: 'products', description: 'The products being announced. Loop with `{{ for products as p }}…{{ endfor }}`.', example: '{{ for products as p }}{{p.title}}{{ endfor }}', },
            { name: 'products[].title', description: 'Product name.', example: '{{products[0].title}}', },
            { name: 'products[].url', description: 'Full link to the product page.', example: '{{products[0].url}}', },
            { name: 'products[].imageUrl', description: 'Main product image, empty when it has none.', },
            { name: 'products[].price', description: 'Cheapest variant price, formatted (e.g. $25.00).', },
            { name: 'products[].priceCents', description: 'The same price in cents, for your own formatting.', },
            { name: 'productCount', description: 'How many products are in this announcement.', },
            { name: 'productsHtml', description: 'The built-in two-up image + price grid, ready to drop into your own layout.', example: '{{productsHtml}}', },
            { name: 'shop.url', description: 'Link to the storefront.', },
        ],
    },

    // ── Events ──
    {
        key: 'event_registered',
        label: "You're registered (attendee)",
        description: 'Sent to an attendee who registers for an event with no tickets. A ticket sign-up gets the ticket email instead.',
        feature: 'events',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: "You're registered: {{event.title}}",
        variables: [
            { name: 'event.title', description: 'The event title.', example: 'Summer Gala', },
            { name: 'event.location', description: 'Where it is (may be empty).', },
            { name: 'event.url', description: "Link to the event's page.", },
            { name: 'occurrence.date', description: 'The date registered for (YYYY-MM-DD).', example: '2026-10-20', },
            { name: 'occurrence.when', description: "The date and time in the event's time zone.", example: 'Tuesday, October 20, 2026 at 7:00 PM (EDT)', },
            { name: 'registration.name', description: "The attendee's name (may be empty).", },
            { name: 'registration.email', description: "The attendee's email.", },
        ],
    },
    {
        key: 'event_unregistered',
        label: 'Registration cancelled (attendee)',
        description: 'Sent to an attendee who cancels their own free registration from the event page.',
        feature: 'events',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'Registration cancelled: {{event.title}}',
        variables: [
            { name: 'event.title', description: 'The event title.', },
            { name: 'event.location', description: 'Where it is (may be empty).', },
            { name: 'event.url', description: "Link to the event's page.", },
            { name: 'occurrence.date', description: 'The date cancelled (YYYY-MM-DD).', },
            { name: 'occurrence.when', description: "The date and time in the event's time zone.", },
            { name: 'registration.name', description: "The attendee's name (may be empty).", },
            { name: 'registration.email', description: "The attendee's email.", },
        ],
    },
    {
        key: 'event_tickets',
        label: 'Your tickets (attendee)',
        description: 'Sent to a ticket buyer with their ticket codes, each linking to its ticket page.',
        feature: 'events',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: 'Your tickets: {{event.title}}',
        variables: [
            { name: 'event.title', description: 'The event title.', },
            { name: 'event.location', description: 'Where it is (may be empty).', },
            { name: 'event.url', description: "Link to the event's page.", },
            { name: 'occurrence.date', description: 'The date the tickets are for (YYYY-MM-DD).', },
            { name: 'occurrence.when', description: "The date and time in the event's time zone.", },
            { name: 'tickets', description: 'The tickets. Loop with `{{ for tickets as t }}…{{ endfor }}`.', example: '{{ for tickets as t }}{{t.code}}{{ endfor }}', },
            { name: 'tickets[].code', description: 'The ticket code.', example: 'ABCDE-23456', },
            { name: 'tickets[].tier', description: 'The ticket type.', example: 'General', },
            { name: 'tickets[].url', description: "Link to the ticket's page.", },
            { name: 'ticketsHtml', description: 'The built-in table of codes, each linked — drop it into your own layout.', example: '{{ticketsHtml}}', },
        ],
    },

    // ── Posts (contributors) ──
    {
        key: 'post_submitted_admin',
        label: 'Post submitted for review (staff alert)',
        description: 'Internal alert when a contributor submits a post for review. Goes to the addresses in Settings → Notifications → Post submitted for review.',
        feature: 'posts',
        audience: 'admin',
        defaultEnabled: true,
        defaultSubject: 'Post to review: {{post.title}}',
        variables: [
            { name: 'post.title', description: 'The post title.', },
            { name: 'post.url', description: 'Link to the post in the admin editor (review it there).', },
            { name: 'author.name', description: 'The contributor.', },
            { name: 'author.email', description: "The contributor's email.", },
        ],
    },
    {
        key: 'post_review_result',
        label: 'Post review result',
        description: 'Sent to a contributor when their post is published or returned with a note.',
        feature: 'posts',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: '{{ if review.approved }}Your post is published: {{post.title}}{{ else }}Your post needs changes: {{post.title}}{{ endif }}',
        variables: [
            ...USER_VARS,
            { name: 'post.title', description: 'The post title.', },
            { name: 'post.url', description: 'The published post (approved) or its editor (returned).', },
            { name: 'review.approved', description: '"yes" when published; empty when returned.', example: 'yes', },
            { name: 'review.note', description: "The reviewer's note (may be empty).", example: 'Please add a source for the second quote.', },
        ],
    },

    // ── Forms ──
    {
        key: 'form_submission_admin',
        label: 'Form submission (staff alert)',
        description: 'Internal alert when a visitor submits a form. Goes to the addresses in Settings → Notifications.',
        feature: 'forms',
        audience: 'admin',
        defaultEnabled: true,
        defaultSubject: 'New submission: {{form.title}}',
        variables: [
            { name: 'form.title', description: 'The form’s title.', },
            { name: 'form.slug', description: 'The form’s slug.', },
            { name: 'submission.answersHtml', description: 'Every answer, laid out like the form (sections, half/full field widths).', example: '{{submission.answersHtml}}', },
            { name: 'submission.url', description: 'Link to the submission in the admin.', },
        ],
    },

    // ── Comments ──
    {
        key: 'comment_reply',
        label: 'Comment reply',
        description: 'Sent to a member when someone replies to their comment on a post or event. Members can turn reply emails off site-wide in Comments → Settings.',
        feature: 'comments',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: '{{reply.authorName}} replied to your comment on {{item.title}}',
        variables: [
            ...USER_VARS,
            { name: 'item.title', description: 'Title of the post or event.', example: 'Summer Gala', },
            { name: 'item.url', description: 'Link straight to the reply.', example: 'https://example.com/posts/summer-gala#comment-…', },
            { name: 'reply.authorName', description: 'Who replied.', example: 'Grace', },
            { name: 'reply.excerpt', description: 'The reply as plain text (up to 300 characters).', },
            { name: 'reply.bodyHtml', description: 'The reply, formatted.', },
            { name: 'comment.excerpt', description: 'The recipient\'s own comment, as plain text.', },
        ],
    },

    {
        key: 'forum_reply',
        label: 'Forum reply',
        description: 'Sent to a member when someone replies to their forum thread, or to their post in a thread.',
        feature: 'forum',
        audience: 'user',
        defaultEnabled: true,
        defaultSubject: '{{reply.authorName}} replied in “{{thread.title}}”',
        variables: [
            ...USER_VARS,
            { name: 'thread.title', description: 'The thread title.', example: 'Show us your setup', },
            { name: 'thread.url', description: 'Link straight to the reply.', example: 'https://example.com/forum/general/show-us-your-setup#comment-…', },
            { name: 'reply.authorName', description: 'Who replied.', example: 'Grace', },
            { name: 'reply.excerpt', description: 'The reply as plain text (up to 300 characters).', },
            { name: 'reply.bodyHtml', description: 'The reply, formatted.', },
        ],
    },

    // ── Messages ──
    {
        key: 'contact_message_admin',
        label: 'Contact message (staff alert)',
        description: 'Internal alert when a visitor sends a contact message.',
        feature: 'messages',
        audience: 'admin',
        defaultEnabled: true,
        defaultSubject: 'New contact message on {{site.name}}',
        variables: [
            { name: 'message.name', description: 'Sender name.', },
            { name: 'message.email', description: 'Sender email.', },
            { name: 'message.subject', description: 'Message subject.', },
            { name: 'message.body', description: 'Message body.', },
        ],
    },
];

/** Look up one purpose. Returns undefined for an unknown key. */
export function mailPurpose(key: string,): MailPurposeMeta | undefined {
    return MAIL_PURPOSES.find((p,) => p.key === key,);
}

/** Purposes belonging to one feature, in registry order. */
export function mailPurposesForFeature(feature: string,): MailPurposeMeta[] {
    return MAIL_PURPOSES.filter((p,) => p.feature === feature,);
}

/** Operator overrides for one purpose. Empty `blocks` = use the built-in default. */
export interface MailPurposeConfig {
    enabled?: boolean;
    subject?: string;
    /** Mail block tree (the `mail_template_blocks` wire shape). */
    blocks?: unknown[];
    /** Only meaningful when the purpose declares `supportsAutoSend`. */
    autoSend?: boolean;
}

/** The `mail_purposes` keyed settings row: purpose key → overrides. */
export type MailPurposeSettings = Record<string, MailPurposeConfig>;
