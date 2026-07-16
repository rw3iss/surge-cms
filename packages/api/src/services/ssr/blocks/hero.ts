import type { SsrBlockRenderer, } from './index';
import { escapeHtml, sanitize, } from './_util';

export const renderHero: SsrBlockRenderer = (block,) => {
    const settings = (block.settings || {}) as Record<string, any>;
    const heroBits: string[] = [];
    const t = block.title || (settings.title as string) || '';
    const subtitle = (settings.subtitle as string) || '';
    const content = block.content || (settings.content as string) || '';
    if (t) heroBits.push(`<h2>${escapeHtml(t,)}</h2>`,);
    if (subtitle) heroBits.push(`<p>${escapeHtml(subtitle,)}</p>`,);
    if (content) heroBits.push(sanitize(content,),);
    if (heroBits.length === 0) return '';
    return `<section class="ssr-block ssr-block--hero">${heroBits.join('',)}</section>`;
};
