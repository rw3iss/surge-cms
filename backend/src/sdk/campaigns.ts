/**
 * cms.campaigns — fundraising campaigns + donations.
 *
 * Wraps `repositories/campaigns.repo` with the SDK contract: typed
 * CRUD plus public listing, slug lookup, donation accessors, and the
 * dashboard donation summary. Cache invalidation + audit log on writes.
 */
import type { Campaign, Donation, DonationSummary, } from '@rw/shared';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import * as repo from '../repositories/campaigns.repo';
import type { AuditContext, ListResult, PaginationOpts, } from './types';

export type { CampaignFilters, PublicCampaignOptions, } from '../repositories/campaigns.repo';

// ─── Reads ────────────────────────────────────────────────────────

export async function list(
    filters: repo.CampaignFilters = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<Campaign>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const result = await repo.findAllCampaigns(filters, { page, limit, },);
    return {
        data: result.data,
        meta: {
            page,
            limit,
            total: result.total,
            totalPages: Math.ceil(result.total / limit,),
        },
    };
}

export async function listPublic(options: repo.PublicCampaignOptions = {},): Promise<Campaign[]> {
    return repo.findPublicCampaigns(options,);
}

export async function getById(id: string,): Promise<Campaign | null> {
    try {
        return await repo.findCampaignById(id,);
    } catch {
        return null;
    }
}

export async function getBySlug(slug: string,): Promise<Campaign | null> {
    return repo.findCampaignBySlug(slug,);
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
    await cache.invalidateCampaignCache();
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
    await cache.invalidateCampaignCache();
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
    const limit = pagination.limit ?? 50;
    const result = await repo.findCampaignDonations(campaignId, { page, limit, },);
    return {
        data: result.data,
        meta: {
            page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,),
        },
    };
}

export async function listAllDonations(pagination: PaginationOpts = {},): Promise<ListResult<Donation>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 50;
    const result = await repo.findAllDonations({}, { page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };
}

export async function donationSummary(): Promise<DonationSummary> {
    return repo.getDonationSummary();
}
