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
            { name: 'submission.answersHtml', description: 'A rendered table of the submitted answers.', },
            { name: 'submission.url', description: 'Link to the submission in the admin.', },
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
