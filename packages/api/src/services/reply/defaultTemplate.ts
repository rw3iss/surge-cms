/**
 * The built-in **Default Template** for every reply (donations, form
 * submissions, …): site logo on top linking home → the message → logo footer.
 * Used whenever no Mailing Lists template is chosen — and the only option when
 * that feature is off. Code-defined, table-based, inline-styled: it is already
 * email HTML, so it needs no block render pass.
 */
import { escapeHtml, } from '../../utils/html';
import { brandedMessage, brandLayout, type BrandLayout, } from '../mail/branded';

export type ReplyLayout = BrandLayout;

/** Plain text → safe HTML paragraphs: blank lines split paragraphs, single
 *  newlines become <br>. Everything is escaped first. This is what
 *  `{{reply.message}}` holds. */
export function messageToHtml(message: string,): string {
    return message
        .replace(/\r\n?/g, '\n',)
        .trim()
        .split(/\n{2,}/,)
        .map((p,) => p.trim())
        .filter(Boolean,)
        .map((p,) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p,).replace(/\n/g, '<br>',)}</p>`)
        .join('',);
}

/** The Default Template around an already-HTML message body — the standard
 *  branded layout (`mail/branded.ts`). */
export function renderDefaultReply(messageHtml: string, layout: ReplyLayout,): string {
    return brandedMessage(messageHtml, layout,);
}

export const replyLayout = (): Promise<ReplyLayout> => brandLayout();
