/**
 * The "▶ Watch" bar shown ON a video thumbnail in email (and, where a true
 * overlay is impossible, directly under it — styled the same).
 *
 * Half-black (`rgba(0,0,0,.5)`) with white text. Outlook for Windows ignores
 * rgba, so the cell also carries `bgcolor="#000000"`: a solid dark bar there.
 */
import { escapeHtml, } from './_util';

/** Height of the bar, px. */
export const WATCH_BAR_HEIGHT = 36;

/** Small play arrow (a text glyph — no image to block, no font to load). */
const PLAY = '&#9654;';

/** Bottom corners only — the bar sits at the bottom of a rounded thumbnail. */
const bottomRadius = (radius: string | undefined,): string => (radius ? `;border-radius:0 0 ${radius} ${radius}` : '');

/**
 * The bar as a table CELL (`<td>`), to sit in the poster's own table. With
 * `href` (already escaped) its content is a link, so the bar is clickable when
 * it is not already inside the poster's link.
 */
export function watchBarCell(radius?: string, href?: string, label = 'Watch',): string {
    const content = `<span style="color:#ffffff;font-size:12px">${PLAY}</span>&nbsp;&nbsp;<span style="color:#ffffff">${escapeHtml(label,)}</span>`;
    return `<td class="email-watch-bar" height="${WATCH_BAR_HEIGHT}" bgcolor="#000000" valign="middle" style="height:${WATCH_BAR_HEIGHT}px;padding:0 14px;background-color:#000000;background-color:rgba(0,0,0,0.5);color:#ffffff;font-size:14px;line-height:${WATCH_BAR_HEIGHT}px;font-weight:bold;text-align:left;mso-line-height-rule:exactly${
        bottomRadius(radius,)
    }">${href ? `<a href="${href}" style="display:block;color:#ffffff;text-decoration:none">${content}</a>` : content}</td>`;
}
