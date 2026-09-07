/**
 * "New merchandise is live" announcements — batched, exactly-once.
 *
 * ## The model
 *
 * A product is **pending announcement** when it is `active` and has never been
 * announced (`merch_announced_at IS NULL`). That per-product stamp is the whole
 * mechanism, and it is deliberately not a single global "last announced at":
 *
 *  - a product activated out of order, or back-dated by an import, still gets
 *    announced — a date window would skip it silently;
 *  - re-publishing an already-announced product stays quiet, so the
 *    archive → fix a typo → re-publish cycle doesn't re-mail anyone;
 *  - a failed send leaves the stamp unset, so the batch is retried rather than
 *    lost.
 *
 * ## How it sends
 *
 * Through `mailSend.send()` — the same campaign pipeline the Mailing Lists send
 * wizard uses. That buys batching, retry with backoff, RFC 8058
 * `List-Unsubscribe` headers and resume-after-restart. The previous version sent
 * directly from inside a product save, which had none of those and was therefore
 * capped at 500 subscribers; there is no cap now.
 *
 * ## What triggers it
 *
 * Nothing automatic on publish. Publishing only leaves the product pending.
 * Either the operator sends the batch from the Shop dashboard, or — when the
 * `shop_new_merchandise` purpose has `autoSend` on — an hourly cron sweeps
 * and sends whatever has accumulated as ONE email. Per-publish sending
 * is what produced an email per product, which is what this replaces.
 */
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { config, } from '../../config';
import { getRaw as getShopSettings, } from './settings';
import { getPurposeConfig, } from '../mail/purposes';
import * as mailSend from '../mailSend';
import type { AuditContext, } from '../types';
import { escapeHtml, } from '../mail/blocks/_util';

export interface PendingProduct {
    id: string;
    title: string;
    slug: string;
    priceCents: number | null;
    imageUrl: string | null;
    createdAt: string;
}

/** Products live on the storefront that have never been announced. */
export async function listPending(limit = 100,): Promise<PendingProduct[]> {
    const r = await query<{
        id: string; title: string; slug: string;
        price_cents: string | number | null; image_url: string | null; created_at: Date;
    }>(
        `SELECT p.id, p.title, p.slug, p.created_at,
                (SELECT MIN(v.price_cents) FROM shop_variants v WHERE v.product_id = p.id) AS price_cents,
                (SELECT COALESCE(m.url, spm.external_url)
                   FROM shop_product_media spm
                   LEFT JOIN media m ON m.id = spm.media_id
                  WHERE spm.product_id = p.id AND spm.kind = 'image'
                  ORDER BY spm.position ASC LIMIT 1) AS image_url
           FROM shop_products p
          WHERE p.status = 'active' AND p.merch_announced_at IS NULL
          ORDER BY p.created_at DESC
          LIMIT $1`,
        [Math.max(1, Math.min(500, limit,),),],
    );
    return r.rows.map((x,) => ({
        id: x.id,
        title: x.title,
        slug: x.slug,
        priceCents: x.price_cents == null ? null : Number(x.price_cents,),
        imageUrl: x.image_url,
        createdAt: new Date(x.created_at,).toISOString(),
    }),);
}

/** Named products, whatever their announced state — the operator may deliberately
 *  re-announce, or include something older in a batch. */
export async function listByIds(ids: string[],): Promise<PendingProduct[]> {
    if (ids.length === 0) return [];
    const all = await query<{ id: string; }>(
        `SELECT id FROM shop_products WHERE id = ANY($1) AND status = 'active'`,
        [ids,],
    );
    const live = new Set(all.rows.map((r,) => r.id));
    const pending = await listPendingOrNamed(ids,);
    return pending.filter((p,) => live.has(p.id,));
}

async function listPendingOrNamed(ids: string[],): Promise<PendingProduct[]> {
    const r = await query<{
        id: string; title: string; slug: string;
        price_cents: string | number | null; image_url: string | null; created_at: Date;
    }>(
        `SELECT p.id, p.title, p.slug, p.created_at,
                (SELECT MIN(v.price_cents) FROM shop_variants v WHERE v.product_id = p.id) AS price_cents,
                (SELECT COALESCE(m.url, spm.external_url)
                   FROM shop_product_media spm
                   LEFT JOIN media m ON m.id = spm.media_id
                  WHERE spm.product_id = p.id AND spm.kind = 'image'
                  ORDER BY spm.position ASC LIMIT 1) AS image_url
           FROM shop_products p
          WHERE p.id = ANY($1)
          ORDER BY p.created_at DESC`,
        [ids,],
    );
    return r.rows.map((x,) => ({
        id: x.id,
        title: x.title,
        slug: x.slug,
        priceCents: x.price_cents == null ? null : Number(x.price_cents,),
        imageUrl: x.image_url,
        createdAt: new Date(x.created_at,).toISOString(),
    }),);
}

function siteBase(): string {
    return (config.frontendUrl as string | undefined ?? '').replace(/\/+$/, '',);
}

function money(cents: number | null, currency: string,): string {
    if (cents == null) return '';
    const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
    return `${symbol}${(cents / 100).toFixed(2,)}`;
}

/**
 * The announcement body, as mail blocks.
 *
 * Built as concrete `html` blocks rather than an `entity` block: entity and
 * template blocks render EMPTY in email (`mail/blocks/index.ts`), because the
 * mail emitter is synchronous and cannot fetch a template. Emitting the product
 * grid here keeps the images and prices that a bare list of links loses.
 */
export function buildAnnouncementBlocks(
    products: PendingProduct[],
    opts: { currency: string; intro?: string; },
): mailSend.SendBlockInput[] {
    const base = siteBase();
    const cards = products.map((p,) => {
        const url = `${base}/shop/${p.slug}`;
        const price = money(p.priceCents, opts.currency,);
        // Table-based: the mail renderer targets email clients, where flex and
        // grid are unreliable.
        return `<td width="50%" valign="top" style="padding:0 8px 20px">
            ${
            p.imageUrl
                ? `<a href="${escapeHtml(url,)}"><img src="${escapeHtml(p.imageUrl,)}" width="260" alt="${
                    escapeHtml(p.title,)
                }" style="width:100%;max-width:260px;border-radius:8px;display:block" /></a>`
                : ''
        }
            <a href="${escapeHtml(url,)}" style="display:block;margin-top:8px;font-weight:700;font-size:15px;color:#111;text-decoration:none">${
            escapeHtml(p.title,)
        }</a>
            ${price ? `<div style="margin-top:2px;font-size:14px;color:#555">${escapeHtml(price,)}</div>` : ''}
        </td>`;
    },);

    // Two per row.
    const rows: string[] = [];
    for (let i = 0; i < cards.length; i += 2) {
        rows.push(`<tr>${cards[i]}${cards[i + 1] ?? '<td width="50%"></td>'}</tr>`,);
    }
    const grid = `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows.join('',)}</table>`;

    const blocks: mailSend.SendBlockInput[] = [];
    let position = 0;
    if (opts.intro) {
        blocks.push({
            blockType: 'rich_text',
            position: position++,
            settings: { content: opts.intro, },
        },);
    }
    blocks.push({ blockType: 'html', position: position++, settings: { content: grid, }, },);
    blocks.push({
        blockType: 'html',
        position: position++,
        settings: {
            content:
                `<p style="text-align:center;margin:24px 0 0"><a href="${escapeHtml(`${base}/shop`,)}" `
                + `style="display:inline-block;padding:12px 26px;background:#111;color:#fff;`
                + `border-radius:999px;text-decoration:none;font-weight:700">Visit the shop</a></p>`,
        },
    },);
    return blocks;
}

export interface AnnounceResult {
    jobId: string;
    recipients: number;
    products: number;
}

/**
 * Send an announcement for the given products and stamp them announced.
 *
 * The stamp lands only AFTER the job is created, so a failure leaves the
 * products pending and the batch can be retried.
 */
export async function announce(
    input: { productIds: string[]; subject?: string; intro?: string; },
    ctx: AuditContext,
): Promise<AnnounceResult> {
    const { settings, } = await getShopSettings();
    const listId = settings.newMerchandiseListId;
    if (!listId) {
        throw new Error('No mailing list is assigned for new-merchandise announcements.',);
    }

    const products = await listByIds(input.productIds,);
    if (products.length === 0) {
        throw new Error('None of the selected products are live.',);
    }

    const cfg = await getPurposeConfig('shop_new_merchandise',);
    const subject = input.subject?.trim()
        || cfg.subject
        || 'New arrivals';

    const result = await mailSend.send({
        listId,
        subject,
        blocks: buildAnnouncementBlocks(products, {
            currency: settings.currency || 'USD',
            intro: input.intro,
        },),
    }, ctx,);

    await query(
        `UPDATE shop_products SET merch_announced_at = NOW() WHERE id = ANY($1)`,
        [products.map((p,) => p.id),],
    );
    logger.info('New-merchandise announcement queued', {
        jobId: result.jobId, products: products.length, recipients: result.total,
    },);
    return { jobId: result.jobId, recipients: result.total, products: products.length, };
}

/**
 * Cron sweep: if auto-send is on, announce everything pending as ONE email.
 *
 * Batching is the entire point — the previous behaviour mailed the list once per
 * published product. Runs on a schedule rather than on publish so a burst of
 * publishing (or a catalogue sync) collapses into a single message.
 */
export async function runAutoAnnounce(): Promise<void> {
    try {
        const cfg = await getPurposeConfig('shop_new_merchandise',);
        if (!cfg.enabled || !cfg.autoSend) return;

        const { settings, } = await getShopSettings();
        if (!settings.newMerchandiseListId) {
            logger.warn('New-merchandise auto-send is on but no mailing list is assigned',);
            return;
        }

        const pending = await listPending();
        if (pending.length === 0) return;

        await announce(
            { productIds: pending.map((p,) => p.id), },
            // No operator behind a cron run; the user agent is what makes the
            // audit row legible as "this was the scheduler, not a person".
            { userId: '', ipAddress: '', userAgent: 'cron:merchandise-announce', },
        );
    } catch (err) {
        // A cron must never throw into the scheduler.
        logger.error('runAutoAnnounce failed', { error: err, },);
    }
}
