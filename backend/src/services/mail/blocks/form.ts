import { BlockEmailRenderer, } from './index';
import { absUrl, escapeHtml, } from './_util';

/**
 * Form → CTA fallback. Forms don't submit cleanly from email, so we
 * render a button linking to the form's public page.
 */
export const renderForm: BlockEmailRenderer = (node, ctx,) => {
    const slug = String(node.settings.formSlug ?? node.settings.slug ?? '',);
    const label = String(node.settings.ctaText ?? node.settings.label ?? 'Open the form',);
    const target = slug ? absUrl(ctx.siteUrl, `/forms/${slug}`,) : ctx.siteUrl || '#';
    return {
        content: `<a href="${escapeHtml(target,)}" style="background:${ctx.linkColor};color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">${escapeHtml(label,)}</a>`,
        cellStyle: { 'text-align': 'center', },
    };
};
