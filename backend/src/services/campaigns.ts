/**
 * Campaigns service — fundraising campaigns + donations (headless spec).
 *
 * Wraps `repositories/campaigns.repo`: typed CRUD, public listing
 * (published-only), slug lookup, donation accessors, the dashboard
 * donation summary, and bulk actions. Owns campaign cache invalidation
 * and audit logging. The `sdk/campaigns.ts` shim re-exports it so
 * `cms.campaigns` keeps working for scripts and plugins.
 *
 * Caching note: every public read here resolves through the repo's
 * published-only queries (`is_published = true`). There is NO admin
 * bypass in those queries, so the public list and slug caches are safe
 * to populate for anonymous readers unconditionally — an admin cannot
 * poison them with draft data the way the posts module could.
 */
import type { Campaign, Donation, DonationSummary, } from '@rw/shared';
import * as repo from '../repositories/campaigns.repo';
import { performBulkAction, } from '../utils/bulkActions';
import type { BulkActionResult, } from '../utils/bulkActions';
import { logAudit, } from './audit';
import { cache, } from './cache';
import type { AuditContext, ListResult, PaginationOpts, } from './types';

export type { CampaignFilters, PublicCampaignOptions, } from '../repositories/campaigns.repo';

// ─── Admin reads ──────────────────────────────────────────────────

export async function list(
    filters: repo.CampaignFilters & { sortBy?: string; sortOrder?: string; } = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<Campaign>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const result = await repo.findAllCampaigns(filters, { page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };
}

export async function getById(id: string,): Promise<Campaign | null> {
    try {
        return await repo.findCampaignById(id,);
    } catch {
        return null;
    }
}

// ─── Public reads (published-only — cache freely for anonymous) ──────

export async function listPublic(options: repo.PublicCampaignOptions = {},): Promise<Campaign[]> {
    return repo.findPublicCampaigns(options,);
}

/** Public campaign list with anonymous caching. Published-only query →
 *  no admin shaping → safe to cache for any anonymous reader. */
export async function listPublicCached(options: repo.PublicCampaignOptions = {},): Promise<Campaign[]> {
    const { includePast = false, activeOnly = true, sortBy = 'created_at', sortOrder = 'desc', } = options;
    const cacheKey = `campaigns:public:${includePast}:${activeOnly}:${sortBy}:${sortOrder}`;

    const cached = await cache.get<Campaign[]>(cacheKey,);
    if (cached) return cached;

    const campaigns = await repo.findPublicCampaigns({ includePast, activeOnly, sortBy, sortOrder, },);
    await cache.set(cacheKey, campaigns, 300,);
    return campaigns;
}

export async function getBySlug(slug: string,): Promise<Campaign | null> {
    return repo.findCampaignBySlug(slug,);
}

/** Public slug fetch with anonymous caching. Published-only → safe. */
export async function getPublicBySlugCached(slug: string,): Promise<Campaign | null> {
    const cacheKey = `campaign:slug:${slug}`;
    const cached = await cache.get<Campaign>(cacheKey,);
    if (cached) return cached;

    const campaign = await repo.findCampaignBySlug(slug,);
    if (!campaign) return null;

    await cache.set(cacheKey, campaign, 300,);
    return campaign;
}

// ─── Writes ───────────────────────────────────────────────────────

export async function create(
    data: Record<string, unknown>,
    ctx: AuditContext,
): Promise<Campaign> {
    const campaign = await repo.createCampaign(data, ctx.userId,);
    await cache.invalidateCampaignCache();
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'campaign',
        entityId: campaign.id,
        newValues: data,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return campaign;
}

export async function update(
    id: string,
    patch: Record<string, unknown>,
    ctx: AuditContext,
): Promise<Campaign> {
    const campaign = await repo.updateCampaign(id, patch,);
    await cache.invalidateCampaignCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'campaign',
        entityId: id,
        newValues: patch,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return campaign;
}

export async function remove(id: string, ctx: AuditContext,): Promise<Campaign | null> {
    const existing = await getById(id,);
    if (!existing) return null;
    await repo.deleteCampaign(id,);
    await cache.invalidateCampaignCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'campaign',
        entityId: id,
        oldValues: existing as unknown as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return existing;
}

// ─── Donations ────────────────────────────────────────────────────

export async function listDonationsForCampaign(
    campaignId: string,
    pagination: PaginationOpts = {},
): Promise<ListResult<Record<string, unknown>>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const result = await repo.findCampaignDonations(campaignId, { page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };
}

export async function listAllDonations(
    filters: { campaignId?: string; status?: string; } = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<Donation>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 50;
    const result = await repo.findAllDonations(filters, { page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };
}

/** Dashboard donation summary, cached 300s (admin-only data). */
export async function donationSummary(): Promise<DonationSummary> {
    const cacheKey = 'donations:summary';
    const cached = await cache.get<DonationSummary>(cacheKey,);
    if (cached) return cached;

    const summary = await repo.getDonationSummary();
    await cache.set(cacheKey, summary, 300,);
    return summary;
}

// ─── Bulk ─────────────────────────────────────────────────────────

export async function bulk(body: unknown,): Promise<BulkActionResult> {
    return performBulkAction(body, {
        table: 'campaigns',
        allowedStatuses: ['draft', 'active', 'completed', 'cancelled',],
        softDelete: false,
        onInvalidate: () => cache.invalidateCampaignCache(),
    },);
}
