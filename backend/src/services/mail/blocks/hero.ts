import { BlockEmailRenderer, } from './index';
import { escapeHtml, resolveColorForEmail, } from './_util';

export const renderHero: BlockEmailRenderer = (node, ctx,) => {
    const title = String(node.settings.title ?? '',);
    const subtitle = String(node.settings.subtitle ?? node.settings.lede ?? '',);
    const bgImage = String(node.settings.backgroundImage ?? node.settings.image ?? '',);
    const ctaText = String(node.settings.ctaText ?? '',);
    const ctaUrl = String(node.settings.ctaUrl ?? '',);

    // CTA button uses the block's textColor as foreground if set,
    // otherwise white; background uses the resolved site link color.
    const cta = ctaText && ctaUrl
        ? `<div style="padding-top:16px"><a href="${escapeHtml(ctaUrl,)}" style="background:${ctx.linkColor};color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">${escapeHtml(ctaText,)}</a></div>`
        : '';

    // Background image lives inline on the inner div so block.style's
    // backgroundColor (from the cell wrapper) still works as a
    // fallback if the image fails to load.
    const bgStyle = bgImage
        ? `background-image:url(${escapeHtml(bgImage,)});background-size:cover;background-position:center;`
        : '';

    // The cell-level block.style is applied by renderNode. We only
    // emit inner content here — but hero traditionally has a centered
    // text layout and big padding, so we let the cell padding (default
    // 16px from block.style) cover the spacing.
    const content = `
        <div style="text-align:center;${bgStyle}">
            <h1 style="margin:0 0 8px;font-size:28px">${escapeHtml(title,)}</h1>
            ${subtitle ? `<div style="font-size:16px;color:${resolveColorForEmail(node.style.textColor as string | undefined, ctx.palette, '#555',)}">${escapeHtml(subtitle,)}</div>` : ''}
            ${cta}
        </div>
    `;
    // Hero defaults to a touch more padding than the default cell.
    return { content, cellStyle: { padding: '32px 24px', }, };
};
