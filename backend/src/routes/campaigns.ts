import { Router } from 'express';
import { z } from 'zod';
import Stripe from 'stripe';
import { query } from '../db';
import { cache } from '../services/cache';
import { config } from '../config';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { NotFoundError } from '../middleware/error';
import { logger } from '../utils/logger';
import type { Campaign, Donation, CampaignStatus, DonationVisibility } from '@surge/shared';

const router = Router();
const stripe = new Stripe(config.stripe.secretKey);

const campaignSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
  description: z.string(),
  shortDescription: z.string().optional(),
  featuredImage: z.string().url().nullish(),
  goalAmountCents: z.number().int().positive(),
  status: z.enum(['draft', 'active', 'completed', 'cancelled']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  isPublished: z.boolean().optional(),
});

const donationIntentSchema = z.object({
  campaignId: z.string().uuid().optional(),
  amountCents: z.number().int().min(100), // Minimum $1
  donorName: z.string().optional(),
  donorEmail: z.string().email(),
  message: z.string().max(500).optional(),
  visibility: z.enum(['public', 'anonymous', 'hidden']).optional(),
});

function toCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as string,
    title: row.title as string,
    slug: row.slug as string,
    description: row.description as string,
    shortDescription: row.short_description as string | undefined,
    featuredImage: row.featured_image as string | undefined,
    goalAmountCents: row.goal_amount_cents as number,
    currentAmountCents: row.current_amount_cents as number,
    status: row.status as CampaignStatus,
    startDate: row.start_date ? new Date(row.start_date as string) : undefined,
    endDate: row.end_date ? new Date(row.end_date as string) : undefined,
    donorCount: row.donor_count as number,
    isPublished: row.is_published as boolean,
    createdBy: row.created_by as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function toDonation(row: Record<string, unknown>): Donation {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string | undefined,
    userId: row.user_id as string | undefined,
    donorName: row.donor_name as string | undefined,
    donorEmail: row.donor_email as string,
    amountCents: row.amount_cents as number,
    message: row.message as string | undefined,
    visibility: row.visibility as DonationVisibility,
    stripePaymentIntentId: row.stripe_payment_intent_id as string,
    stripeChargeId: row.stripe_charge_id as string | undefined,
    status: row.status as 'pending' | 'completed' | 'failed' | 'refunded',
    createdAt: new Date(row.created_at as string),
  };
}

// Get published campaigns (public)
router.get('/public', async (req, res) => {
  try {
    const { includePast = 'false' } = req.query;
    const cacheKey = `campaigns:public:${includePast}`;

    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    let whereClause = `WHERE is_published = true AND status = 'active'`;
    if (includePast === 'true') {
      whereClause = `WHERE is_published = true AND status IN ('active', 'completed')`;
    }

    const result = await query(
      `SELECT * FROM campaigns ${whereClause} ORDER BY created_at DESC`
    );

    const campaigns = result.rows.map(toCampaign);

    await cache.set(cacheKey, campaigns, 300);

    res.json({ success: true, data: campaigns });
  } catch (error) {
    logger.error('Error fetching public campaigns', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch campaigns' },
    });
  }
});

// Get campaign by slug (public)
router.get('/slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const cacheKey = `campaign:slug:${slug}`;

    const cached = await cache.get<Campaign>(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const result = await query(
      `SELECT * FROM campaigns WHERE slug = $1 AND is_published = true`,
      [slug]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Campaign');
    }

    const campaign = toCampaign(result.rows[0]);

    await cache.set(cacheKey, campaign, 300);

    res.json({ success: true, data: campaign });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    logger.error('Error fetching campaign', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch campaign' },
    });
  }
});

// Get campaign donations (public - respects visibility)
router.get('/:id/donations', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const result = await query(
      `SELECT d.*,
              CASE WHEN d.visibility = 'anonymous' THEN 'Anonymous' ELSE d.donor_name END as donor_name,
              CASE WHEN d.visibility = 'hidden' THEN NULL ELSE d.message END as message
       FROM donations d
       WHERE d.campaign_id = $1 AND d.status = 'completed' AND d.visibility != 'hidden'
       ORDER BY d.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, Number(limit), offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) FROM donations WHERE campaign_id = $1 AND status = 'completed' AND visibility != 'hidden'`,
      [id]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const donations = result.rows.map((row) => ({
      id: row.id,
      donorName: row.visibility === 'anonymous' ? 'Anonymous' : row.donor_name,
      amountCents: row.amount_cents,
      message: row.visibility === 'hidden' ? null : row.message,
      createdAt: row.created_at,
    }));

    res.json({
      success: true,
      data: donations,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error('Error fetching campaign donations', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch donations' },
    });
  }
});

// Get all campaigns (admin)
router.get('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      whereClause += ` AND status = $${params.length}`;
    }

    const countResult = await query(`SELECT COUNT(*) FROM campaigns ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(Number(limit), offset);
    const result = await query(
      `SELECT * FROM campaigns ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const campaigns = result.rows.map(toCampaign);

    res.json({
      success: true,
      data: campaigns,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error('Error fetching campaigns', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch campaigns' },
    });
  }
});

// Get campaign by ID (admin)
router.get('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const result = await query('SELECT * FROM campaigns WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new NotFoundError('Campaign');
    }

    const campaign = toCampaign(result.rows[0]);

    res.json({ success: true, data: campaign });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    logger.error('Error fetching campaign', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch campaign' },
    });
  }
});

// Create campaign (admin)
router.post('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const data = campaignSchema.parse(req.body);

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
        req.userId,
      ]
    );

    await cache.invalidateCampaignCache();

    const campaign = toCampaign(result.rows[0]);

    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    logger.error('Error creating campaign', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create campaign' },
    });
  }
});

// Update campaign (admin)
router.put('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const data = campaignSchema.partial().parse(req.body);

    const existing = await query('SELECT id FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      throw new NotFoundError('Campaign');
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        values.push(value);
        updates.push(`${dbKey} = $${values.length}`);
      }
    });

    if (updates.length === 0) {
      return res.json({ success: true, data: toCampaign(existing.rows[0]) });
    }

    values.push(id);
    const result = await query(
      `UPDATE campaigns SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    await cache.invalidateCampaignCache(id);

    const campaign = toCampaign(result.rows[0]);

    res.json({ success: true, data: campaign });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    logger.error('Error updating campaign', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update campaign' },
    });
  }
});

// Delete campaign (admin)
router.delete('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const result = await query('DELETE FROM campaigns WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      throw new NotFoundError('Campaign');
    }

    await cache.invalidateCampaignCache(id);

    res.json({ success: true, data: { message: 'Campaign deleted' } });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    logger.error('Error deleting campaign', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete campaign' },
    });
  }
});

// Get donation summary (admin)
router.get('/donations/summary', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const cacheKey = 'donations:summary';
    const cached = await cache.get(cacheKey);

    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const totalAllTime = await query(
      `SELECT COALESCE(SUM(amount_cents), 0) as total FROM donations WHERE status = 'completed'`
    );

    const totalThisMonth = await query(
      `SELECT COALESCE(SUM(amount_cents), 0) as total FROM donations
       WHERE status = 'completed' AND created_at >= date_trunc('month', CURRENT_DATE)`
    );

    const totalThisYear = await query(
      `SELECT COALESCE(SUM(amount_cents), 0) as total FROM donations
       WHERE status = 'completed' AND created_at >= date_trunc('year', CURRENT_DATE)`
    );

    const campaignBreakdown = await query(
      `SELECT c.id as campaign_id, c.title as campaign_title, COALESCE(SUM(d.amount_cents), 0) as total
       FROM campaigns c
       LEFT JOIN donations d ON d.campaign_id = c.id AND d.status = 'completed'
       GROUP BY c.id, c.title
       ORDER BY total DESC`
    );

    const generalDonations = await query(
      `SELECT COALESCE(SUM(amount_cents), 0) as total FROM donations
       WHERE campaign_id IS NULL AND status = 'completed'`
    );

    const summary = {
      totalAllTime: parseInt(totalAllTime.rows[0].total, 10),
      totalThisMonth: parseInt(totalThisMonth.rows[0].total, 10),
      totalThisYear: parseInt(totalThisYear.rows[0].total, 10),
      campaignBreakdown: campaignBreakdown.rows.map((row) => ({
        campaignId: row.campaign_id,
        campaignTitle: row.campaign_title,
        total: parseInt(row.total, 10),
      })),
      generalDonations: parseInt(generalDonations.rows[0].total, 10),
    };

    await cache.set(cacheKey, summary, 300);

    res.json({ success: true, data: summary });
  } catch (error) {
    logger.error('Error fetching donation summary', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch donation summary' },
    });
  }
});

// Create donation payment intent
router.post('/donate', authenticate(false), async (req: AuthenticatedRequest, res) => {
  try {
    const data = donationIntentSchema.parse(req.body);

    // Verify campaign exists if provided
    if (data.campaignId) {
      const campaign = await query(
        `SELECT id FROM campaigns WHERE id = $1 AND is_published = true AND status = 'active'`,
        [data.campaignId]
      );
      if (campaign.rows.length === 0) {
        throw new NotFoundError('Campaign');
      }
    }

    // Create Stripe Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: data.amountCents,
      currency: 'usd',
      metadata: {
        campaignId: data.campaignId || 'general',
        donorEmail: data.donorEmail,
        donorName: data.donorName || 'Anonymous',
        message: data.message || '',
        visibility: data.visibility || 'public',
        userId: req.userId || '',
      },
    });

    // Create pending donation record
    await query(
      `INSERT INTO donations (campaign_id, user_id, donor_name, donor_email, amount_cents,
                              message, visibility, stripe_payment_intent_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
      [
        data.campaignId || null,
        req.userId || null,
        data.donorName,
        data.donorEmail,
        data.amountCents,
        data.message,
        data.visibility || 'public',
        paymentIntent.id,
      ]
    );

    res.json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    logger.error('Error creating donation intent', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create donation' },
    });
  }
});

// Stripe webhook handler
router.post('/webhook', async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    if (!sig || !config.stripe.webhookSecret) {
      return res.status(400).json({ error: 'Missing signature' });
    }

    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      config.stripe.webhookSecret
    );

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;

        await query(
          `UPDATE donations SET status = 'completed', stripe_charge_id = $1
           WHERE stripe_payment_intent_id = $2`,
          [paymentIntent.latest_charge, paymentIntent.id]
        );

        await cache.invalidateCampaignCache();
        logger.info('Donation completed', { paymentIntentId: paymentIntent.id });
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;

        await query(
          `UPDATE donations SET status = 'failed' WHERE stripe_payment_intent_id = $1`,
          [paymentIntent.id]
        );

        logger.warn('Donation failed', { paymentIntentId: paymentIntent.id });
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;

        await query(
          `UPDATE donations SET status = 'refunded' WHERE stripe_charge_id = $1`,
          [charge.id]
        );

        await cache.invalidateCampaignCache();
        logger.info('Donation refunded', { chargeId: charge.id });
        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Webhook error', { error });
    res.status(400).json({ error: 'Webhook error' });
  }
});

// Get all donations (admin)
router.get('/donations/all', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { campaignId, status, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (campaignId) {
      if (campaignId === 'general') {
        whereClause += ` AND campaign_id IS NULL`;
      } else {
        params.push(campaignId);
        whereClause += ` AND campaign_id = $${params.length}`;
      }
    }

    if (status) {
      params.push(status);
      whereClause += ` AND status = $${params.length}`;
    }

    const countResult = await query(`SELECT COUNT(*) FROM donations ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(Number(limit), offset);
    const result = await query(
      `SELECT d.*, c.title as campaign_title
       FROM donations d
       LEFT JOIN campaigns c ON d.campaign_id = c.id
       ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const donations = result.rows.map(toDonation);

    res.json({
      success: true,
      data: donations,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error('Error fetching all donations', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch donations' },
    });
  }
});

export default router;
