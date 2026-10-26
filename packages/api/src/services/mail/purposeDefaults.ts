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
import { brandedEmail, brandLayoutFrom, type BrandLayout, } from './branded';
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

/** The standard branded layout (logo header + footer) around the body. */
function card(inner: string, layout: BrandLayout,): string {
    return brandedEmail(`<tr><td style="padding:16px 32px 28px">${inner}</td></tr>`, layout,);
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

        case 'user_invite': {
            const roles = pick(ctx, 'roles',);
            body = H(`You're invited to ${escapeHtml(siteName,)}`,)
                + greeting(name,)
                + P(`You've been invited to create a ${escapeHtml(siteName,)} account${roles ? ` as a <strong>${escapeHtml(roles,)}</strong>` : ''}. Click below to set your name and password.`,)
                + button(pick(ctx, 'invite_url',), 'Create my account',)
                + rawLink(pick(ctx, 'invite_url',),)
                + P(`The link works until ${escapeHtml(pick(ctx, 'expires_at',) || 'it expires in 3 days',)}. If you weren't expecting this, you can ignore it.`,);
            break;
        }

        case 'user_role_added': {
            const roles = pick(ctx, 'roles',);
            body = H(`New role: ${roles || 'member'}`,)
                + greeting(name,)
                + P(`Your ${escapeHtml(siteName,)} account now has the <strong>${escapeHtml(roles,)}</strong> role. Sign in as usual to use it.`,)
                + button(pick(ctx, 'login_url',), 'Sign in',);
            break;
        }

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

        case 'user_subscription_changed': {
            const row = (label: string, prefix: string,) => {
                const name = pick(ctx, `${prefix}.name`,);
                const price = pick(ctx, `${prefix}.price`,);
                const freq = pick(ctx, `${prefix}.frequency`,);
                const desc = pick(ctx, `${prefix}.description`,);
                return `<tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:110px">${label}</td>`
                    + `<td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:14px"><strong>${escapeHtml(name || '—',)}</strong>`
                    + (price ? ` · ${escapeHtml(price,)}${freq ? ` ${escapeHtml(freq,)}` : ''}` : '')
                    + (desc ? `<br><span style="color:#6b7280;font-size:13px">${escapeHtml(desc,)}</span>` : '')
                    + `</td></tr>`;
            };
            body = H('Your membership changed',)
                + greeting(name,)
                + P(escapeHtml(pick(ctx, 'subscription.note',) || 'Your membership was updated.',),)
                + `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 16px">`
                + row('Previous', 'subscription.previous',)
                + row('New', 'subscription.current',)
                + `</table>`
                + button(`${site.siteUrl}/profile?tab=membership`, 'Manage your membership',)
                + MUTED(`If you didn't make this change, contact us right away.`,);
            break;
        }

        case 'membership_application_received': {
            const tier = pick(ctx, 'tier.name',) || 'membership';
            const url = pick(ctx, 'application.claimUrl',);
            const view = pick(ctx, 'application.viewUrl',);
            body = H('Application received',)
                + greeting(name,)
                + P(`Thank you for applying for <strong>${escapeHtml(tier,)}</strong>. Your request has been submitted, and someone from our team will contact you soon.`,)
                + (pick(ctx, 'application.next',) ? P(escapeHtml(pick(ctx, 'application.next',),),) : '')
                // Something left to do (account / card) → finish it; else follow it.
                + (url ? button(url, 'Finish my application',) : view ? button(view, 'View my applications',) : '');
            break;
        }

        case 'membership_application_approved': {
            const tier = pick(ctx, 'tier.name',) || 'membership';
            const offer = pick(ctx, 'application.offer',) === 'yes';
            const note = pick(ctx, 'note',);
            const expires = pick(ctx, 'application.offerExpires',);
            const program = pick(ctx, 'application.program',) === 'yes';
            const invited = pick(ctx, 'application.invited',) === 'yes';
            body = H(`You're approved for ${tier}`,)
                + greeting(name,)
                + P(`Good news — your application for <strong>${escapeHtml(tier,)}</strong> was approved.`,)
                + (note ? P(escapeHtml(note,),) : '')
                + (program
                    ? (invited
                        ? P('We have sent you a separate email with an invitation to create your account — your access is added when you sign up.',)
                        : P(`You now have ${escapeHtml(tier,)} access on your account.`,) + button(`${site.siteUrl}/login`, 'Sign in',))
                    : offer
                    ? P('Choose your billing and start your membership:',)
                        + button(pick(ctx, 'application.claimUrl',) || `${site.siteUrl}/profile?tab=membership`, 'Start my membership',)
                        + MUTED(`${expires ? `This offer is open until ${escapeHtml(expires,)}. ` : ''}Nothing has been charged yet.`,)
                    : P('Your membership is active.',) + button(`${site.siteUrl}/profile?tab=membership`, 'View my membership',));
            break;
        }

        case 'membership_application_rejected': {
            const tier = pick(ctx, 'tier.name',) || 'membership';
            const note = pick(ctx, 'note',);
            body = H(`Your Application for ${tier}`,)
                + greeting(name,)
                + P(`Thank you for applying for <strong>${escapeHtml(tier,)}</strong>. We are not able to approve your application at this time.`,)
                // The reviewer's reason (Reject dialog), when one was given.
                + (note
                    ? `<div style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #e5e7eb;background:#f9fafb">`
                        + `<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#6b7280">Reason</p>`
                        + `<p style="margin:0;font-size:15px;line-height:1.5;color:#111">${escapeHtml(note,).replace(/\r?\n/g, '<br>',)}</p></div>`
                    : '')
                + (pick(ctx, 'application.card',) === 'yes' ? MUTED('Your card was not charged.',) : '');
            break;
        }

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
            // order.trackingHtml is built by orderEmails from escaped values.
            const th = pick(ctx, 'order.trackingHtml',);
            body = H('Your order has shipped',)
                + greeting(name,)
                + P(`Order <strong>${escapeHtml(pick(ctx, 'order.number',),)}</strong> is on its way.`,)
                + (th ? th : tn ? P(`Tracking: <strong>${escapeHtml(tn,)}</strong>`
                    + (pick(ctx, 'order.carrier',) ? ` (${escapeHtml(pick(ctx, 'order.carrier',),)})` : ''),) : '')
                + (!th && tu ? button(tu, 'Track your parcel',) : '');
            break;
        }

        case 'shop_new_merchandise':
            body = H(`New at ${siteName}`,)
                + greeting(name,)
                + P(`We've just added new items to the shop.`,)
                + (pick(ctx, 'productsHtml',) || '')
                + (pick(ctx, 'shop.url',) ? button(pick(ctx, 'shop.url',), 'Shop now',) : '');
            break;

        case 'post_submitted_admin':
            body = H('Post submitted for review',)
                + P(`<strong>${escapeHtml(pick(ctx, 'author.name',) || 'A contributor',)}</strong> submitted <strong>${escapeHtml(pick(ctx, 'post.title',),)}</strong> for review.`,)
                + (pick(ctx, 'post.url',) ? button(pick(ctx, 'post.url',), 'Review the post',) : '');
            break;

        case 'post_review_result': {
            const ok = pick(ctx, 'review.approved',) === 'yes';
            const note = pick(ctx, 'review.note',);
            body = H(ok ? 'Your post is published' : 'Your post needs changes',)
                + greeting(name,)
                + P(ok
                    ? `Good news — <strong>${escapeHtml(pick(ctx, 'post.title',),)}</strong> was reviewed and is now published.`
                    : `<strong>${escapeHtml(pick(ctx, 'post.title',),)}</strong> was reviewed and returned to you as a draft.`,)
                + (note
                    ? `<div style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #e5e7eb;background:#f9fafb">`
                        + `<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#6b7280">Note from the editor</p>`
                        + `<p style="margin:0;font-size:15px;line-height:1.5;color:#111">${escapeHtml(note,).replace(/\r?\n/g, '<br>',)}</p></div>`
                    : '')
                + (pick(ctx, 'post.url',) ? button(pick(ctx, 'post.url',), ok ? 'Read it' : 'Edit your post',) : '');
            break;
        }

        case 'form_submission_admin':
            body = H('New form submission',)
                + P(`Someone submitted <strong>${escapeHtml(pick(ctx, 'form.title',),)}</strong> on ${escapeHtml(siteName,)}.`,)
                + (pick(ctx, 'submission.answersHtml',) || '')
                + (pick(ctx, 'submission.url',) ? button(pick(ctx, 'submission.url',), 'View submission',) : '');
            break;

        case 'comment_reply':
            body = greeting(pick(ctx, 'user.name',),)
                + P(`<strong>${escapeHtml(pick(ctx, 'reply.authorName',),)}</strong> replied to your comment on <strong>${escapeHtml(pick(ctx, 'item.title',),)}</strong>:`,)
                // reply.bodyHtml comes from the safe Markdown renderer (escaped first).
                + `<div style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #e5e7eb;font-size:15px;line-height:1.5;color:#111">${pick(ctx, 'reply.bodyHtml',) || escapeHtml(pick(ctx, 'reply.excerpt',),)}</div>`
                + (pick(ctx, 'comment.excerpt',) ? MUTED(`Your comment: “${escapeHtml(pick(ctx, 'comment.excerpt',),)}”`,) : '')
                + (pick(ctx, 'item.url',) ? button(pick(ctx, 'item.url',), 'View the reply',) : '');
            break;

        case 'forum_reply':
            body = greeting(pick(ctx, 'user.name',),)
                + P(`<strong>${escapeHtml(pick(ctx, 'reply.authorName',),)}</strong> replied in <strong>${escapeHtml(pick(ctx, 'thread.title',),)}</strong>:`,)
                // reply.bodyHtml comes from the safe Markdown renderer (escaped first).
                + `<div style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #e5e7eb;font-size:15px;line-height:1.5;color:#111">${pick(ctx, 'reply.bodyHtml',) || escapeHtml(pick(ctx, 'reply.excerpt',),)}</div>`
                + (pick(ctx, 'thread.url',) ? button(pick(ctx, 'thread.url',), 'View the reply',) : '');
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

    return resolveMailTemplate(card(body, brandLayoutFrom(site,),), ctx, { html: true, },);
}
