import type { BlockStyle, } from '@surge/shared';
import { Router, } from 'express';
import { z, } from 'zod';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import * as blockStylesRepo from '../repositories/blockStyles.repo';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import { handleRouteError, sendCreated, sendSuccess, } from '../utils/response';

const router = Router();
const CACHE_KEY = 'block_styles:all';

const blockStyleSchema = z.object({
    name: z.string().min(1,).max(255,),
    isDefault: z.boolean().optional(),
    backgroundColor: z.string().nullable().optional(),
    textColor: z.string().nullable().optional(),
    textAlign: z.string().nullable().optional(),
    verticalAlign: z.string().nullable().optional(),
    fontSize: z.string().nullable().optional(),
    width: z.string().nullable().optional(),
    padding: z.string().nullable().optional(),
    margin: z.string().nullable().optional(),
},);

/** Convert null values to undefined so they match Partial<BlockStyle>. */
function nullsToUndefined(obj: Record<string, unknown>,): Partial<BlockStyle> {
    const result: Record<string, unknown> = {};
    for (const [key, value,] of Object.entries(obj,)) {
        result[key] = value === null ? undefined : value;
    }
    return result as Partial<BlockStyle>;
}

// GET / - List all block styles (admin, cached)
router.get('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const cached = await cache.get(CACHE_KEY,);
        if (cached) return sendSuccess(res, cached,);

        const styles = await blockStylesRepo.findAll();
        await cache.set(CACHE_KEY, styles, 600,);
        sendSuccess(res, styles,);
    } catch (error) {
        handleRouteError(res, error, 'fetch block styles',);
    }
},);

// GET /:id - Get single block style
router.get('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const style = await blockStylesRepo.findById(req.params.id,);
        sendSuccess(res, style,);
    } catch (error) {
        handleRouteError(res, error, 'fetch block style',);
    }
},);

// POST / - Create block style
router.post('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = blockStyleSchema.parse(req.body,);
        const style = await blockStylesRepo.create(nullsToUndefined(data,),);
        await cache.del(CACHE_KEY,);
        await logAudit({
            userId: req.userId!,
            action: 'create',
            entityType: 'block_style',
            entityId: style.id,
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendCreated(res, style,);
    } catch (error) {
        handleRouteError(res, error, 'create block style',);
    }
},);

// PUT /:id - Update block style
router.put('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = blockStyleSchema.partial().parse(req.body,);
        const style = await blockStylesRepo.update(req.params.id, nullsToUndefined(data,),);
        await cache.del(CACHE_KEY,);
        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'block_style',
            entityId: req.params.id,
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, style,);
    } catch (error) {
        handleRouteError(res, error, 'update block style',);
    }
},);

// DELETE /:id - Delete block style
router.delete('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await blockStylesRepo.remove(req.params.id,);
        await cache.del(CACHE_KEY,);
        await logAudit({
            userId: req.userId!,
            action: 'delete',
            entityType: 'block_style',
            entityId: req.params.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, { message: 'Block style deleted', },);
    } catch (error) {
        handleRouteError(res, error, 'delete block style',);
    }
},);

export default router;
