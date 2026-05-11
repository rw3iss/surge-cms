import { BlockEmailRenderer, } from './index';
import { escapeHtml, } from './_util';

export const renderHero: BlockEmailRenderer = (node, ctx,) => {
    const title = String(node.settings.title ?? '',);
    const subtitle = String(node.settings.subtitle ?? node.settings.lede ?? '',);
    const bgImage = String(node.settings.backgroundImage ?? node.settings.image ?? '',);
    const ctaText = String(node.settings.ctaText ?? '',);
    const ctaUrl = String(node.settings.ctaUrl ?? '',);

    const cta = ctaText && ctaUrl
        ? `<div style="padding-top:16px"><a href="${escapeHtml(ctaUrl,)}" style="background:${ctx.linkColor};color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">${escapeHtml(ctaText,)}</a></div>`
        : '';

    const bgStyle = bgImage
        ? `background-image:url(${escapeHtml(bgImage,)});background-size:cover;background-position:center;`
        : '';

    return `<tr><td style="padding:32px 24px;text-align:center;${bgStyle}background:${ctx.bgColor === '#ffffff' ? '#f7fafc' : ctx.bgColor}">
        <h1 style="margin:0 0 8px;font-size:28px;color:${ctx.textColor}">${escapeHtml(title,)}</h1>
        ${subtitle ? `<div style="font-size:16px;color:#555">${escapeHtml(subtitle,)}</div>` : ''}
        ${cta}
    </td></tr>`;
};
