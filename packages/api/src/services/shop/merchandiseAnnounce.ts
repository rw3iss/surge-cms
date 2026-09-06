/**
 * "New merchandise is live" announcement to the shop's mailing list.
 *
 * ## Why this is opt-in and guarded
 *
 * A product going live is not, on its own, a decision to email your audience.
 * Operators publish in batches, un-publish to fix a typo and re-publish, and
 * sync catalogues from suppliers — each of which would otherwise fire a
 * broadcast. So:
 *
 *  - the `shop_new_merchandise` purpose must be ENABLED, and
 *  - its `autoSend` must be ON (off by default), and
 *  - a mailing list must be assigned in Shop settings.
 *
 * With all three set, publishing a product mails the list once. The
 * `announced_at` stamp is what makes it once: re-publishing an already-announced
 * product is a no-op, so the archive/restore cycle above stays quiet.
 */
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { config, } from '../../config';
import { getRaw as getShopSettings, } from './settings';
import { getPurposeConfig, sendPurposeMail, } from '../mail/purposes';
import * as mailingLists from '../mailingLists';
import { escapeHtml, } from '../mail/blocks/_util';

/**
 * Above this many subscribers the automatic send bows out (see the comment at
 * the send site). Chosen to be comfortably within what a single request can do
 * without timing out, while covering the small lists this feature is aimed at.
 */
const MAX_AUTO_RECIPIENTS = 500;

interface AnnounceProduct {
    id: string;
    title: string;
    slug: string;
}

/** Render a simple list of the products for the default body. */
function productsHtml(products: AnnounceProduct[], siteUrl: string,): string {
    const base = siteUrl.replace(/\/+$/, '',);
    return `<ul style="margin:0 0 20px;padding-left:18px;font-size:15px;line-height:1.6">`
        + products.map((p,) =>
            `<li><a href="${escapeHtml(`${base}/shop/${p.slug}`,)}" style="color:#2563eb">${escapeHtml(p.title,)}</a></li>`
        ).join('',)
        + `</ul>`;
}

/**
 * Announce newly-published products, if the operator has asked for that.
 *
 * Never throws — it runs off the back of a product save, and a mail problem
 * must not fail the save that triggered it.
 */
export async function announceNewMerchandise(productIds: string[],): Promise<void> {
    if (productIds.length === 0) return;
    try {
        const cfg = await getPurposeConfig('shop_new_merchandise',);
        // autoSend is the operator's explicit "yes, mail the list on publish".
        if (!cfg.enabled || !cfg.autoSend) return;

        const { settings, } = await getShopSettings();
        const listId = settings.newMerchandiseListId;
        if (!listId) {
            logger.warn('New-merchandise auto-send is on but no mailing list is assigned',);
            return;
        }

        // Only products that are live AND not already announced.
        const r = await query<AnnounceProduct>(
            `SELECT id, title, slug FROM shop_products
              WHERE id = ANY($1) AND status = 'active' AND merch_announced_at IS NULL`,
            [productIds,],
        );
        const products = r.rows;
        if (products.length === 0) return;

        // KNOWN LIMITATION: this sends directly rather than enqueuing a
        // `mail_send_jobs` run, so it does NOT get the campaign pipeline's
        // batching, retry or RFC 8058 List-Unsubscribe headers. That is fine at
        // small scale and wrong at large scale, so the send is CAPPED: past the
        // cap we refuse and tell the operator to send it as a campaign from
        // Mailing Lists, rather than quietly firing thousands of unthrottled
        // messages from inside a product save.
        const page = await mailingLists.listSubscribers(listId, {
            limit: MAX_AUTO_RECIPIENTS + 1, status: 'subscribed',
        },);
        const subscribers = (page.items ?? [])
            .map((sub: { email: string; },) => sub.email)
            .filter(Boolean,);

        if (subscribers.length === 0) {
            logger.info('New-merchandise announcement skipped: list has no subscribers', { listId, },);
            return;
        }
        if (subscribers.length > MAX_AUTO_RECIPIENTS) {
            logger.warn(
                'New-merchandise auto-send skipped: list is too large for a direct send. '
                + 'Send it as a campaign from Mailing Lists instead.',
                { listId, subscribers: subscribers.length, cap: MAX_AUTO_RECIPIENTS, },
            );
            return;
        }

        const base = (config.frontendUrl as string | undefined ?? '').replace(/\/+$/, '',);
        await sendPurposeMail('shop_new_merchandise', {
            to: subscribers,
            context: {
                products: products.map((p,) => ({ title: p.title, slug: p.slug, url: `${base}/shop/${p.slug}`, })),
                productsHtml: productsHtml(products, base,),
                shop: { url: `${base}/shop`, },
            },
        },);

        // Stamped AFTER a successful send, so a failure retries on the next
        // publish rather than silently swallowing the announcement.
        await query(
            `UPDATE shop_products SET merch_announced_at = NOW() WHERE id = ANY($1)`,
            [products.map((p,) => p.id),],
        );
        logger.info('New-merchandise announcement sent', {
            products: products.length, recipients: subscribers.length,
        },);
    } catch (err) {
        logger.error('announceNewMerchandise failed', { error: err, },);
    }
}
