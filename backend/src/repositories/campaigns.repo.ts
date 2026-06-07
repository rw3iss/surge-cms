import type { Campaign, Donation, DonationSummary, } from '@rw/cms-shared';
import { query, } from '../db';
import { mapRow, mapRows, } from '../utils/mapRow';
import { uuidOrNull, } from '../utils/uuid';
import {
    deleteById,
    findByIdOrThrow,
    paginatedQuery,
    PaginatedResult,
    PaginationOptions,
    updateById,
} from './base.repo';

export interface CampaignFilters {
    status?: string;
    includePast?: boolean;
}

const VALID_SORT_COLUMNS: Record<string, string> = {
    created_at: 'created_at',
    updated_at: 'updated_at',
    start_date: 'start_date',
    end_date: 'end_date',
    title: 'title',
    status: 'status',
    goal_amount_cents: 'goal_amount_cents',
    current_amount_cents: 'current_amount_cents',
    donor_count: 'donor_count',
    donation_percent: 'CASE WHEN goal_amount_cents > 0 THEN (current_amount_cents::float / goal_amount_cents) ELSE 0 END',
};

function buildSortClause(sortBy?: string, sortOrder?: string,): string {
    const column = VALID_SORT_COLUMNS[sortBy || 'created_at'] || 'created_at';
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
    return `ORDER BY ${column} ${direction}`;
}

// ─── Campaigns ───

export interface PublicCampaignOptions {
    includePast?: boolean;
    activeOnly?: boolean;
    sortBy?: string;
    sortOrder?: string;
}

export async function findPublicCampaigns(options: PublicCampaignOptions = {},): Promise<Campaign[]> {
    const { includePast = false, activeOnly = true, sortBy, sortOrder, } = options;

    let whereClause = 'WHERE is_published = true';

    if (includePast) {
        whereClause += ` AND status IN ('active', 'completed')`;
    } else {
        whereClause += ` AND status = 'active'`;
    }

    if (activeOnly) {
        whereClause += ` AND (start_date IS NULL OR start_date <= NOW())`;
        whereClause += ` AND (end_date IS NULL OR end_date > NOW())`;
    }

    const orderClause = buildSortClause(sortBy, sortOrder,);

    const result = await query(
        `SELECT * FROM campaigns ${whereClause} ${orderClause}`,
    );
    return mapRows<Campaign>(result.rows,);
}

export async function findCampaignBySlug(slug: string,): Promise<Campaign | null> {
    const result = await query(
        `SELECT * FROM campaigns WHERE slug = $1 AND is_published = true`,
        [slug,],
    );
    return result.rows.length > 0 ? mapRow<Campaign>(result.rows[0],) : null;
}

export async function findCampaignById(id: string,): Promise<Campaign> {
    return findByIdOrThrow<Campaign>('campaigns', id, 'Campaign',);
}

export async function findAllCampaigns(
    filters: CampaignFilters & { sortBy?: string; sortOrder?: string; },
    pagination: PaginationOptions,
): Promise<PaginatedResult<Campaign>> {
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filters.status) {
        params.push(filters.status,);
        whereClause += ` AND status = $${params.length}`;
    }

    const orderClause = buildSortClause(filters.sortBy || 'updated_at', filters.sortOrder || 'desc',);

    return paginatedQuery<Campaign>(
        `SELECT * FROM campaigns ${whereClause} ${orderClause}`,
        `SELECT COUNT(*) FROM campaigns ${whereClause}`,
        params,
        pagination,
    );
}

export async function createCampaign(data: Record<string, unknown>, userId: string,): Promise<Campaign> {
    const result = await query(
        `INSERT INTO campaigns (title, slug, description, short_description, featured_image,
                            goal_amount_cents, status, start_date, end_date, is_published, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
        [
            data.title,
            data.slug,
            data.description,
            data.shortDescription,
            data.featuredImage,
            data.goalAmountCents,
            data.status || 'draft',
            data.startDate,
            data.endDate,
            data.isPublished || false,
            // created_by is a UUID FK; synthetic actors (api-key:<name>,
            // system) become NULL.
            uuidOrNull(userId,),
        ],
    );
    return mapRow<Campaign>(result.rows[0],);
}

export async function updateCampaign(id: string, data: Record<string, unknown>,): Promise<Campaign> {
    return updateById<Campaign>('campaigns', id, data, 'Campaign',);
}

export async function deleteCampaign(id: string,): Promise<void> {
    return deleteById('campaigns', id, 'Campaign',);
}

// ─── Donations ───

export async function findCampaignDonations(
    campaignId: string,
    pagination: PaginationOptions,
): Promise<PaginatedResult<Record<string, unknown>>> {
    const params = [campaignId,];

    const countResult = await query(
        `SELECT COUNT(*) FROM donations WHERE campaign_id = $1 AND status = 'completed' AND visibility != 'hidden'`,
        params,
    );
    const total = parseInt(countResult.rows[0].count, 10,);

    const offset = (pagination.page - 1) * pagination.limit;
    const result = await query(
        `SELECT d.*,
            CASE WHEN d.visibility = 'anonymous' THEN 'Anonymous' ELSE d.donor_name END as donor_name,
            CASE WHEN d.visibility = 'hidden' THEN NULL ELSE d.message END as message
     FROM donations d
     WHERE d.campaign_id = $1 AND d.status = 'completed' AND d.visibility != 'hidden'
     ORDER BY d.created_at DESC
     LIMIT $2 OFFSET $3`,
        [campaignId, pagination.limit, offset,],
    );

    const data = result.rows.map((row,) => ({
        id: row.id,
        donorName: row.visibility === 'anonymous' ? 'Anonymous' : row.donor_name,
        amountCents: row.amount_cents,
        message: row.visibility === 'hidden' ? null : row.message,
        createdAt: row.created_at,
    }));

    return { data, total, };
}

export async function findAllDonations(
    filters: { campaignId?: string; status?: string; },
    pagination: PaginationOptions,
): Promise<PaginatedResult<Donation>> {
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filters.campaignId) {
        if (filters.campaignId === 'general') {
            whereClause += ` AND d.campaign_id IS NULL`;
        } else {
            params.push(filters.campaignId,);
            whereClause += ` AND d.campaign_id = $${params.length}`;
        }
    }
    if (filters.status) {
        params.push(filters.status,);
        whereClause += ` AND d.status = $${params.length}`;
    }

    const countResult = await query(
        `SELECT COUNT(*) FROM donations d ${whereClause}`,
        params,
    );
    const total = parseInt(countResult.rows[0].count, 10,);

    const offset = (pagination.page - 1) * pagination.limit;
    params.push(pagination.limit, offset,);
    const result = await query(
        `SELECT d.*, c.title as campaign_title
     FROM donations d
     LEFT JOIN campaigns c ON d.campaign_id = c.id
     ${whereClause}
     ORDER BY d.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    return { data: mapRows<Donation>(result.rows,), total, };
}

export async function getDonationSummary(): Promise<DonationSummary> {
    const [totalAll, totalMonth, totalYear, breakdown, general,] = await Promise.all([
        query(`SELECT COALESCE(SUM(amount_cents), 0) as total FROM donations WHERE status = 'completed'`,),
        query(
            `SELECT COALESCE(SUM(amount_cents), 0) as total FROM donations WHERE status = 'completed' AND created_at >= date_trunc('month', CURRENT_DATE)`,
        ),
        query(
            `SELECT COALESCE(SUM(amount_cents), 0) as total FROM donations WHERE status = 'completed' AND created_at >= date_trunc('year', CURRENT_DATE)`,
        ),
        query(`SELECT c.id as campaign_id, c.title as campaign_title, COALESCE(SUM(d.amount_cents), 0) as total
           FROM campaigns c LEFT JOIN donations d ON d.campaign_id = c.id AND d.status = 'completed'
           GROUP BY c.id, c.title ORDER BY total DESC`,),
        query(
            `SELECT COALESCE(SUM(amount_cents), 0) as total FROM donations WHERE campaign_id IS NULL AND status = 'completed'`,
        ),
    ],);

    return {
        totalAllTime: parseInt(totalAll.rows[0].total, 10,),
        totalThisMonth: parseInt(totalMonth.rows[0].total, 10,),
        totalThisYear: parseInt(totalYear.rows[0].total, 10,),
        campaignBreakdown: breakdown.rows.map((row,) => ({
            campaignId: row.campaign_id,
            campaignTitle: row.campaign_title,
            total: parseInt(row.total, 10,),
        })),
        generalDonations: parseInt(general.rows[0].total, 10,),
    };
}
