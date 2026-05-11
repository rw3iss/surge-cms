import { BlockEmailRenderer, } from './index';
import { absUrl, escapeHtml, } from './_util';

interface ResolvedPost { slug: string; title: string; excerpt?: string; featuredImage?: string; }

/**
 * Post list → row-per-post static list. The send route is responsible
 * for denormalizing `settings.resolvedPosts` from current DB state at
 * render time so each email sees the same content (preview also
 * passes `resolvedPosts` if the operator's template specifies a
 * query). If absent, falls back to a "View latest posts" link.
 */
export const renderPostList: BlockEmailRenderer = (node, ctx,) => {
    const posts: ResolvedPost[] = Array.isArray(node.settings.resolvedPosts,)
        ? (node.settings.resolvedPosts as ResolvedPost[])
        : [];

    if (posts.length === 0) {
        return `<tr><td style="padding:16px;text-align:center">
            <a href="${escapeHtml(absUrl(ctx.siteUrl, '/posts',),)}" style="color:${ctx.linkColor}">View latest posts →</a>
        </td></tr>`;
    }

    const rows = posts.map((p,) => {
        const url = absUrl(ctx.siteUrl, `/posts/${p.slug}`,);
        const thumb = p.featuredImage
            ? `<img src="${escapeHtml(p.featuredImage,)}" alt="" width="600" style="display:block;max-width:100%;border:0;margin-bottom:8px" />`
            : '';
        return `<tr><td style="padding:14px 0;border-bottom:1px solid #eee">
            ${thumb}
            <a href="${escapeHtml(url,)}" style="color:${ctx.linkColor};text-decoration:none;font-weight:600;font-size:17px">${escapeHtml(p.title,)}</a>
            ${p.excerpt ? `<div style="font-size:14px;color:#555;margin-top:4px">${escapeHtml(p.excerpt,)}</div>` : ''}
        </td></tr>`;
    },).join('\n',);

    return `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`;
};
