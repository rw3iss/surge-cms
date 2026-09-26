import { escapeHtml, mediaRadiusCss, } from './_util';
import { BlockEmailRenderer, } from './index';

interface Slide {
    imageUrl?: string;
    title?: string;
    link?: string;
}

/**
 * Carousel → first slide only + "View more" link. Email clients can't
 * cycle slides; rendering them all stacked would look broken.
 */
export const renderCarousel: BlockEmailRenderer = (node, ctx,) => {
    const slides: Slide[] = Array.isArray(node.settings.slides,) ?
        (node.settings.slides as Slide[]) :
        [];
    if (slides.length === 0) return '';

    const first = slides[0];
    const radiusCss = mediaRadiusCss(node,);
    const img = first.imageUrl ?
        `<img src="${escapeHtml(first.imageUrl,)}" alt="${
            escapeHtml(first.title ?? '',)
        }" width="600" style="display:block;max-width:100%;border:0${radiusCss}" />` :
        '';
    const link = first.link ? escapeHtml(first.link,) : '#';
    const wrapped = `<a href="${link}" style="text-decoration:none">${img}</a>`;
    const more = slides.length > 1 ?
        `<div style="text-align:center;padding-top:6px"><a href="${link}" style="color:${ctx.linkColor}">View more →</a></div>` :
        '';

    return wrapped + more;
};
