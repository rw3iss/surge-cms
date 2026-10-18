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
 *
 * ## Which body it sends
 *
 * The operator's template if they wrote one, the built-in layout otherwise —
 * decided by whether the `shop_new_merchandise` purpose has blocks, which is
 * the same rule every other purpose uses. Either way the send carries the
 * announcement's `{{ }}` variables (`products`, `productsHtml`, `shop.url`),
 * so a custom template can lay the products out however it likes without the
 * feature having to guess in advance what shape that is.
 */
import { query, } from '../../db';
import { ValidationError, } from '../../core/errors';
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
 * The built-in two-up product grid, as email-safe HTML.
 *
 * Table-based: the mail renderer targets email clients, where flex and grid are
 * unreliable. Exposed on its own (and as `{{productsHtml}}`) so an operator who
 * writes a custom template can keep this grid and only replace what surrounds
 * it — rebuilding an image + price grid by hand in a block editor is the part
 * nobody wants to do.
 */
export function buildProductGridHtml(products: PendingProduct[], currency: string,): string {
    const base = siteBase();
    const cards = products.map((p,) => {
        const url = `${base}/shop/${p.slug}`;
        const price = money(p.priceCents, currency,);
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
    return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows.join('',)}</table>`;
}

/**
 * The `{{ }}` variables an announcement makes available to its template.
 *
 * Stored on the send job, so an operator-authored template can loop the
 * products (`{{ for products as p }}`) or drop the built-in grid into their own
 * layout (`{{productsHtml}}`). Each product carries a ready-made `url` and a
 * formatted `price` as well as the raw `priceCents`, because a template author
 * should not have to know the site's base URL or divide by 100.
 */
export function buildAnnouncementContext(
    products: PendingProduct[],
    currency: string,
): Record<string, unknown> {
    const base = siteBase();
    return {
        products: products.map((p,) => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            url: `${base}/shop/${p.slug}`,
            imageUrl: p.imageUrl ?? '',
            price: money(p.priceCents, currency,),
            priceCents: p.priceCents,
        })),
        productCount: products.length,
        productsHtml: buildProductGridHtml(products, currency,),
        shop: { url: `${base}/shop`, },
    };
}

/**
 * The built-in announcement body, as mail blocks.
 *
 * Built as concrete `html` blocks rather than an `entity` block: entity and
 * template blocks render EMPTY in email (`mail/blocks/index.ts`), because the
 * mail emitter is synchronous and cannot fetch a template. Emitting the product
 * grid here keeps the images and prices that a bare list of links loses.
 *
 * Used only when the operator has NOT authored a template for the
 * `shop_new_merchandise` purpose — see `announce()`.
 */
export function buildAnnouncementBlocks(
    products: PendingProduct[],
    opts: { currency: string; intro?: string; },
): mailSend.SendBlockInput[] {
    const base = siteBase();
    const grid = buildProductGridHtml(products, opts.currency,);

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
    /** True when the operator's own template was used, false for the built-in
     *  layout. Surfaced so the confirmation says which body actually went out. */
    usedCustomTemplate: boolean;
}

/**
 * Resolve the body for an announcement: the operator's template if they wrote
 * one, otherwise the built-in layout.
 *
 * "Wrote one" means the `shop_new_merchandise` purpose has blocks — the same
 * rule every other purpose uses (`sendPurposeMail`), and the reason the mail
 * settings panel never pre-fills the default into the editor. An empty template
 * is not a broken one; it means "keep sending the built-in body, including any
 * later improvements to it".
 *
 * Both paths get the same `{{ }}` context, so a custom template can loop
 * `products` or embed `{{productsHtml}}`, and the built-in one stays a plain
 * pre-rendered grid.
 */
export function resolveAnnouncementBody(
    products: PendingProduct[],
    opts: { currency: string; intro?: string; customBlocks?: unknown[]; },
): { blocks: mailSend.SendBlockInput[]; context: Record<string, unknown>; usedCustomTemplate: boolean; } {
    const custom = (opts.customBlocks ?? []) as mailSend.SendBlockInput[];
    const usedCustomTemplate = custom.length > 0;
    return {
        blocks: usedCustomTemplate
            ? custom
            : buildAnnouncementBlocks(products, { currency: opts.currency, intro: opts.intro, },),
        context: buildAnnouncementContext(products, opts.currency,),
        usedCustomTemplate,
    };
}

/** A manual re-announce of the same products within this window is a double send. */
const REANNOUNCE_GAP_MINUTES = 10;

/**
 * Atomically claim products for an announcement, returning the claimed ids and
 * each one's previous stamp (so a failed send can put them back).
 *
 * One statement with row locks: two overlapping calls (double click, two
 * admins, the hourly cron racing a manual send) cannot both claim a product.
 * The cron (`manual: false`) only takes never-announced products; a manual
 * send may re-announce older ones, but not anything stamped in the last
 * {@link REANNOUNCE_GAP_MINUTES} minutes.
 */
export async function claimForAnnouncement(
    ids: string[],
    manual: boolean,
): Promise<Array<{ id: string; prev: Date | null; }>> {
    if (!ids.length) return [];
    const r = await query<{ id: string; prev: Date | null; }>(
        `WITH prev AS (
             SELECT id, merch_announced_at FROM shop_products WHERE id = ANY($1::uuid[]) FOR UPDATE
         )
         UPDATE shop_products p SET merch_announced_at = NOW()
           FROM prev
          WHERE p.id = prev.id
            AND (prev.merch_announced_at IS NULL
                 OR ($2::boolean AND prev.merch_announced_at < NOW() - make_interval(mins => $3::int)))
         RETURNING p.id, prev.merch_announced_at AS prev`,
        [ids, manual, REANNOUNCE_GAP_MINUTES,],
    );
    return r.rows;
}

/** Undo a claim after a failed send, so the products stay pending. */
async function releaseClaim(claimed: Array<{ id: string; prev: Date | null; }>,): Promise<void> {
    if (!claimed.length) return;
    await query(
        `UPDATE shop_products p SET merch_announced_at = x.prev
           FROM unnest($1::uuid[], $2::timestamptz[]) AS x(id, prev)
          WHERE p.id = x.id`,
        [claimed.map((c,) => c.id), claimed.map((c,) => c.prev),],
    );
}

/**
 * Send an announcement for the given products and stamp them announced.
 *
 * The products are CLAIMED (stamped) first, in one statement, so a concurrent
 * call cannot mail the same products again; a failed send releases the claim
 * and leaves them pending for a retry.
 */
export async function announce(
    input: { productIds: string[]; subject?: string; intro?: string; },
    ctx: AuditContext,
    opts: { manual?: boolean; } = {},
): Promise<AnnounceResult> {
    const manual = opts.manual !== false;
    const cfg = await getPurposeConfig('shop_new_merchandise',);
    // Disabled means disabled. A manual click is deliberate, but so is turning
    // the email off — sending anyway would make the switch a lie, and the
    // operator can turn it back on in one click. The message names the setting.
    if (!cfg.enabled) {
        throw new ValidationError(
            'The new-merchandise announcement email is turned off. '
                + 'Enable it in Shop settings → Emails → New merchandise announcement.',
        );
    }

    const { settings, } = await getShopSettings();
    const listId = settings.newMerchandiseListId;
    if (!listId) {
        throw new ValidationError('No mailing list is assigned for new-merchandise announcements.',);
    }

    const live = await listByIds(input.productIds,);
    if (live.length === 0) {
        throw new ValidationError('None of the selected products are live.',);
    }

    const claimed = await claimForAnnouncement(live.map((p,) => p.id), manual,);
    const claimedIds = new Set(claimed.map((c,) => c.id),);
    const products = live.filter((p,) => claimedIds.has(p.id,));
    if (products.length === 0) {
        throw new ValidationError('These products were just announced — this would send the same email twice.',);
    }

    const subject = input.subject?.trim()
        || cfg.subject
        || 'New arrivals';

    let result: Awaited<ReturnType<typeof mailSend.send>>;
    let body: ReturnType<typeof resolveAnnouncementBody>;
    try {
        body = resolveAnnouncementBody(products, {
            currency: settings.currency || 'USD',
            intro: input.intro,
            customBlocks: cfg.blocks,
        },);
        result = await mailSend.send({
            listId,
            subject,
            blocks: body.blocks,
            context: body.context,
        }, ctx,);
    } catch (err) {
        await releaseClaim(claimed,).catch((e,) =>
            logger.error('Could not release merchandise claim after a failed send', { error: (e as Error).message, },)
        );
        throw err;
    }

    logger.info('New-merchandise announcement queued', {
        jobId: result.jobId,
        products: products.length,
        recipients: result.total,
        custom: body.usedCustomTemplate,
    },);
    return {
        jobId: result.jobId,
        recipients: result.total,
        products: products.length,
        usedCustomTemplate: body.usedCustomTemplate,
    };
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
            { manual: false, },
        );
    } catch (err) {
        // A cron must never throw into the scheduler.
        logger.error('runAutoAnnounce failed', { error: err, },);
    }
}
