/**
 * Built-in bodies for each mail purpose, used until an operator writes their own.
 *
 * These are plain table-based HTML with inline styles rather than mail block
 * trees. A default only has to LOOK right in an email client — it is never
 * edited in place, because the moment an operator customises a purpose their
 * blocks take over entirely. Generating a block tree just to render it back to
 * the same HTML would buy nothing and couple the defaults to the block schema.
 *
 * Every string that could contain operator or user data goes through
 * `escapeHtml`. `resolveMailTemplate` then runs the result so `{{ }}` in a
 * caller-supplied value still resolves.
 */
import { escapeHtml, } from './blocks/_util';
import { wrapEmailShell, } from './shell';
import { resolveMailTemplate, } from './templateRuntime';
import type { MailRenderContext, } from './siteContext';

/** Read a dotted path out of the render context (`order.number`). */
function pick(ctx: Record<string, unknown>, path: string,): string {
    const v = path.split('.',).reduce<unknown>(
        (acc, k,) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
        ctx,
    );
    return v == null ? '' : String(v,);
}

const SHELL = {
    bg: '#f4f4f5',
    font: 'system-ui,-apple-system,BlinkMacSystemFont,sans-serif',
    color: '#333',
    outerPadding: '32px 12px',
    innerBorder: '1px solid #e5e7eb',
    innerRadius: '8px',
};

function card(inner: string,): string {
    return wrapEmailShell({ bodyHtml: `<tr><td style="padding:32px">${inner}</td></tr>`, ...SHELL, },);
}

const H = (t: string,) => `<h1 style="margin:0 0 16px;font-size:22px;color:#111">${escapeHtml(t,)}</h1>`;
const P = (t: string,) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${t}</p>`;
const MUTED = (t: string,) => `<p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5">${t}</p>`;

function button(url: string, label: string,): string {
    return `<p style="margin:0 0 24px"><a href="${escapeHtml(url,)}" `
        + `style="background:#111827;color:#ffffff;padding:12px 28px;border-radius:6px;`
        + `text-decoration:none;display:inline-block;font-weight:600">${escapeHtml(label,)}</a></p>`;
}

/** "Or paste this link" fallback — some clients strip or rewrite buttons. */
function rawLink(url: string,): string {
    return MUTED(
        `Or paste this link into your browser:<br>`
        + `<a href="${escapeHtml(url,)}" style="color:#2563eb;word-break:break-all">${escapeHtml(url,)}</a>`,
    );
}

function greeting(name: string,): string {
    return P(name ? `Hi ${escapeHtml(name,)},` : 'Hi,');
}

/**
 * Build the default body for a purpose.
 *
 * An unknown key returns a minimal generic card rather than throwing: the
 * caller is mid-checkout or mid-registration, and a missing default is not a
 * reason to fail the operation that triggered it.
 */
export async function defaultPurposeHtml(
    key: string,
    ctx: Record<string, unknown>,
    site: MailRenderContext,
): Promise<string> {
    const name = pick(ctx, 'user.name',) || pick(ctx, 'customer.name',);
    const siteName = site.siteName;
    let body: string;

    switch (key) {
        case 'user_verification':
            body = H('Verify your email',)
                + greeting(name,)
                + P(`Thanks for signing up for ${escapeHtml(siteName,)}. Please confirm your email address to activate your account.`,)
                + button(pick(ctx, 'verification_url',), 'Verify email',)
                + rawLink(pick(ctx, 'verification_url',),);
            break;

        case 'user_password_reset': {
            const expires = pick(ctx, 'expires_in',) || '1 hour';
            body = H('Reset your password',)
                + greeting(name,)
                + P(`Someone asked to reset the password for your ${escapeHtml(siteName,)} account. Click below to choose a new one — the link is valid for ${escapeHtml(expires,)}.`,)
                + button(pick(ctx, 'reset_url',), 'Reset password',)
                + rawLink(pick(ctx, 'reset_url',),)
                // Reassurance matters here: most recipients of an unexpected
                // reset email are worried, and the safe action is to do nothing.
                + `<p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.5">`
                + `If you didn't request this, you can safely ignore this email — your password won't change.</p>`;
            break;
        }

        case 'user_password_changed':
            body = H('Your password was changed',)
                + greeting(name,)
                + P(`The password on your ${escapeHtml(siteName,)} account was just changed.`,)
                + MUTED(`If this wasn't you, reset your password immediately and contact us.`,);
            break;

        case 'user_welcome':
            body = H(`Welcome to ${siteName}`,)
                + greeting(name,)
                + P(`Your account is ready. We're glad to have you.`,)
                + button(site.siteUrl, 'Visit the site',);
            break;

        case 'user_signup_admin':
            body = H('New signup',)
                + P(`A new member registered on ${escapeHtml(siteName,)}.`,)
                + P(`<strong>${escapeHtml(pick(ctx, 'user.name',) || '(no name)',)}</strong><br>`
                    + escapeHtml(pick(ctx, 'user.email',),),);
            break;

        case 'shop_order_customer':
            body = H('Thanks for your order',)
                + greeting(name,)
                + P(`We've received your order <strong>${escapeHtml(pick(ctx, 'order.number',),)}</strong>.`,)
                + (pick(ctx, 'order.itemsHtml',) || '')
                + P(`<strong>Total: ${escapeHtml(pick(ctx, 'order.total',),)}</strong>`,)
                + (pick(ctx, 'order.url',) ? button(pick(ctx, 'order.url',), 'View your order',) : '');
            break;

        case 'shop_order_admin':
            body = H('New order',)
                + P(`Order <strong>${escapeHtml(pick(ctx, 'order.number',),)}</strong> was placed on ${escapeHtml(siteName,)}.`,)
                + P(`${escapeHtml(pick(ctx, 'customer.name',),)} &lt;${escapeHtml(pick(ctx, 'customer.email',),)}&gt;`,)
                + (pick(ctx, 'order.itemsHtml',) || '')
                + P(`<strong>Total: ${escapeHtml(pick(ctx, 'order.total',),)}</strong>`,)
                + (pick(ctx, 'order.adminUrl',) ? button(pick(ctx, 'order.adminUrl',), 'Open in admin',) : '');
            break;

        case 'shop_order_shipped': {
            const tn = pick(ctx, 'order.trackingNumber',);
            const tu = pick(ctx, 'order.trackingUrl',);
            body = H('Your order has shipped',)
                + greeting(name,)
                + P(`Order <strong>${escapeHtml(pick(ctx, 'order.number',),)}</strong> is on its way.`,)
                + (tn ? P(`Tracking: <strong>${escapeHtml(tn,)}</strong>`
                    + (pick(ctx, 'order.carrier',) ? ` (${escapeHtml(pick(ctx, 'order.carrier',),)})` : ''),) : '')
                + (tu ? button(tu, 'Track your parcel',) : '');
            break;
        }

        case 'shop_new_merchandise':
            body = H(`New at ${siteName}`,)
                + greeting(name,)
                + P(`We've just added new items to the shop.`,)
                + (pick(ctx, 'productsHtml',) || '')
                + (pick(ctx, 'shop.url',) ? button(pick(ctx, 'shop.url',), 'Shop now',) : '');
            break;

        case 'form_submission_admin':
            body = H('New form submission',)
                + P(`Someone submitted <strong>${escapeHtml(pick(ctx, 'form.title',),)}</strong> on ${escapeHtml(siteName,)}.`,)
                + (pick(ctx, 'submission.answersHtml',) || '')
                + (pick(ctx, 'submission.url',) ? button(pick(ctx, 'submission.url',), 'View submission',) : '');
            break;

        case 'contact_message_admin':
            body = H('New contact message',)
                + P(`<strong>${escapeHtml(pick(ctx, 'message.name',),)}</strong> &lt;${escapeHtml(pick(ctx, 'message.email',),)}&gt;`,)
                + P(escapeHtml(pick(ctx, 'message.subject',),),)
                + P(escapeHtml(pick(ctx, 'message.body',),).replace(/\n/g, '<br>',),);
            break;

        default:
            body = H(siteName,) + P(`You have a new notification from ${escapeHtml(siteName,)}.`,);
            break;
    }

    return resolveMailTemplate(card(body,), ctx,);
}
