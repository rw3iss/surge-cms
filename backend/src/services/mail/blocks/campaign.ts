import { BlockEmailRenderer, } from './index';
import { absUrl, escapeHtml, } from './_util';

/**
 * Campaign → simple title + blurb + donate CTA. Stripe Elements can't
 * run in email, so we link out to the campaign's public donate page.
 */
export const renderCampaign: BlockEmailRenderer = (node, ctx,) => {
    const title = String(node.settings.title ?? '',);
    const blurb = String(node.settings.blurb ?? node.settings.description ?? '',);
    const slug = String(node.settings.campaignSlug ?? node.settings.slug ?? '',);
    const target = slug ? absUrl(ctx.siteUrl, `/donate/${slug}`,) : absUrl(ctx.siteUrl, '/donate',);
    return `<tr><td style="padding:16px">
        ${title ? `<h2 style="margin:0 0 8px;font-size:20px;color:${ctx.textColor}">${escapeHtml(title,)}</h2>` : ''}
        ${blurb ? `<div style="margin-bottom:12px;color:${ctx.textColor}">${escapeHtml(blurb,)}</div>` : ''}
        <a href="${escapeHtml(target,)}" style="background:${ctx.linkColor};color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Donate</a>
    </td></tr>`;
};
