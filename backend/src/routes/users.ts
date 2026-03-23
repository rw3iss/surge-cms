import { Router, } from 'express';
import { z, } from 'zod';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import * as usersRepo from '../repositories/users.repo';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import { handleRouteError, sendCreated, sendPaginated, sendSuccess, } from '../utils/response';

const router = Router();

const updateUserSchema = z.object({
    displayName: z.string().min(1,).max(255,).optional(),
    role: z.enum(['anonymous', 'member', 'admin',],).optional(),
    isActive: z.boolean().optional(),
},);

const createUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8,),
    displayName: z.string().min(1,).max(255,),
    role: z.enum(['member', 'admin',],).optional(),
},);

const banUserSchema = z.object({
    email: z.string().email().optional(),
    ipAddress: z.string().optional(),
    reason: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
},);

// ─── Admin Routes ───

router.get('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { search, role, status, page = 1, limit = 50, } = req.query;
        const pagination = { page: Number(page,), limit: Number(limit,), };
        const result = await usersRepo.findUsers(
            { search: search as string, role: role as string, status: status as string, },
            pagination,
        );
        sendPaginated(res, result.data, pagination.page, pagination.limit, result.total,);
    } catch (error) {
        handleRouteError(res, error, 'fetch users',);
    }
},);

router.get('/banned/list', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { page = 1, limit = 50, } = req.query;
        const pagination = { page: Number(page,), limit: Number(limit,), };
        const result = await usersRepo.findBans(pagination,);
        sendPaginated(res, result.data, pagination.page, pagination.limit, result.total,);
    } catch (error) {
        handleRouteError(res, error, 'fetch banned list',);
    }
},);

router.get('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const result = await usersRepo.findUserWithMembership(req.params.id,);
        sendSuccess(res, result,);
    } catch (error) {
        handleRouteError(res, error, 'fetch user',);
    }
},);

router.post('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = createUserSchema.parse(req.body,);
        const user = await usersRepo.createUser(data,);
        await logAudit({
            userId: req.userId!,
            action: 'create',
            entityType: 'user',
            entityId: user.id,
            newValues: { email: data.email, displayName: data.displayName, role: data.role, },
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendCreated(res, user,);
    } catch (error) {
        handleRouteError(res, error, 'create user',);
    }
},);

router.put('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = updateUserSchema.parse(req.body,);
        const user = await usersRepo.updateUser(req.params.id, data,);
        await cache.invalidateUserCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'user',
            entityId: req.params.id,
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, user,);
    } catch (error) {
        handleRouteError(res, error, 'update user',);
    }
},);

router.post('/:id/ban', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { reason, expiresAt, } = banUserSchema.parse(req.body,);
        await usersRepo.banUser(req.params.id, req.userId!, reason, expiresAt,);
        await cache.invalidateUserCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'ban',
            entityType: 'user',
            entityId: req.params.id,
            newValues: { reason, expiresAt, },
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, { message: 'User banned successfully', },);
    } catch (error) {
        handleRouteError(res, error, 'ban user',);
    }
},);

router.post('/:id/unban', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await usersRepo.unbanUser(req.params.id,);
        await cache.invalidateUserCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'unban',
            entityType: 'user',
            entityId: req.params.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, { message: 'User unbanned successfully', },);
    } catch (error) {
        handleRouteError(res, error, 'unban user',);
    }
},);

router.post('/ban-ip', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = banUserSchema.parse(req.body,);
        if (!data.ipAddress) {
            return res.status(400,).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'IP address is required', },
            },);
        }
        await usersRepo.banIp(data.ipAddress, req.userId!, data.reason, data.expiresAt,);
        sendSuccess(res, { message: 'IP address banned', },);
    } catch (error) {
        handleRouteError(res, error, 'ban IP',);
    }
},);

router.delete('/banned/:banId', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await usersRepo.removeBan(req.params.banId,);
        sendSuccess(res, { message: 'Ban removed', },);
    } catch (error) {
        handleRouteError(res, error, 'remove ban',);
    }
},);

export default router;
