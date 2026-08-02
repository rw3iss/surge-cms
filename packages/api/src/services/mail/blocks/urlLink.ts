import { BlockEmailRenderer, } from './index';
import { escapeHtml, } from './_util';

/**
 * URL-link block. The editor writes `url`, `title`, `description`, `image`,
 * and `siteName` (a link-preview card). Older/simple links only carry
 * `url` + `text`. We render whatever is present:
 *   - `title` → the linked anchor text (falls back to `text`/`label`/`url`).
 *   - `description` → a muted line under the link.
 *   - `image` → a small preview thumbnail above the link.
 * All fields are emitted so their {{ }} tokens survive into the send-time
 * substitution pass (previously title/description/image were dropped, so
 * a link built entirely from a preview card rendered as a bare URL).
 */
export const renderUrlLink: BlockEmailRenderer = (node, ctx,) => {
    const url = String(node.settings.url ?? '#',);
    const title = String(
        node.settings.title ?? node.settings.text ?? node.settings.label ?? node.settings.url ?? 'Link',
    );
    const description = String(node.settings.description ?? '',);
    const image = String(node.settings.image ?? '',);

    const thumb = image
        ? `<div style="padding-bottom:8px"><a href="${escapeHtml(url,)}"><img src="${escapeHtml(image,)}" alt="" style="max-width:100%;border-radius:4px;border:0" /></a></div>`
        : '';
    const anchor =
        `<a href="${escapeHtml(url,)}" style="color:${ctx.linkColor};text-decoration:underline;font-weight:600">${escapeHtml(title,)}</a>`;
    const desc = description
        ? `<div style="font-size:14px;color:#666;padding-top:4px">${escapeHtml(description,)}</div>`
        : '';

    return `${thumb}${anchor}${desc}`;
};
