import { BlockEmailRenderer, } from './index';
import { escapeHtml, } from './_util';

interface SocialItem { postUrl?: string; postId?: string; thumbnailUrl?: string; content?: string; authorName?: string; }

/**
 * Social → fallback. Embedded provider widgets don't work in email,
 * so each pinned item renders as a card-link with thumbnail + excerpt.
 * Auto-feed (no items) renders an empty row — Phase 5 may denormalize
 * the provider's recent posts into settings at send time.
 */
export const renderSocial: BlockEmailRenderer = (node,) => {
    const items: SocialItem[] = Array.isArray(node.settings.items,)
        ? (node.settings.items as SocialItem[])
        : [];
    const valid = items.filter((i,) => i.postUrl || i.postId,);
    if (valid.length === 0) return '';

    const rows = valid.map((i,) => {
        const url = escapeHtml(i.postUrl ?? '#',);
        const thumb = i.thumbnailUrl
            ? `<img src="${escapeHtml(i.thumbnailUrl,)}" alt="" width="120" style="display:block;float:left;margin-right:12px;border:0" />`
            : '';
        const author = i.authorName ? `<div style="color:#666;font-size:13px;margin-bottom:4px">${escapeHtml(i.authorName,)}</div>` : '';
        const excerpt = escapeHtml(String(i.content ?? '',).slice(0, 220,),);
        return `<tr><td style="padding:12px 0;border-bottom:1px solid #eee">
            <a href="${url}" style="text-decoration:none;color:inherit;display:block;overflow:hidden">
                ${thumb}
                <div style="overflow:hidden">${author}<div>${excerpt}</div></div>
            </a>
        </td></tr>`;
    },).join('\n',);

    return `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`;
};
