import fs from 'fs/promises';
import multer from 'multer';
import { nanoid, } from 'nanoid';
import path from 'path';
import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import { AppError, } from '../core/errors';
import * as users from '../services/users';

// ─── Avatar upload (multer disk staging under DATA_DIR/avatars) ──────

const avatarStorage = multer.diskStorage({
    destination: async (_req, _file, cb,) => {
        await fs.mkdir(users.AVATAR_DIR, { recursive: true, },);
        cb(null, users.AVATAR_DIR,);
    },
    filename: (_req, file, cb,) => {
        const ext = path.extname(file.originalname,).toLowerCase() || '.jpg';
        cb(null, `${nanoid(16,)}${ext}`,);
    },
},);

const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: users.AVATAR_MAX_SIZE, },
    fileFilter: (_req, file, cb,) => {
        if (file.mimetype.startsWith('image/',)) cb(null, true,);
        else cb(new Error('Only image files are allowed',),);
    },
},);

// ─── Schemas ──────────────────────────────────────────────────────

const updateUserSchema = z.object({
    displayName: z.string().min(1,).max(255,).optional(),
    role: z.enum(['anonymous', 'member', 'admin', 'sysadmin',],).optional(),
    isActive: z.boolean().optional(),
    avatarUrl: z.string().optional().nullable(),
},);

const createUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8,),
    displayName: z.string().min(1,).max(255,),
    role: z.enum(['member', 'admin', 'sysadmin',],).optional(),
},);

const banUserSchema = z.object({
    email: z.string().email().optional(),
    ipAddress: z.string().optional(),
    reason: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
},);

const listQuery = z.object({
    search: z.string().optional(),
    role: z.string().optional(),
    status: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(50,),
},);

const bansQuery = z.object({
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(50,),
},);

const idParams = z.object({ id: z.string(), },);

// ─── Routes ───────────────────────────────────────────────────────
// Literal paths (/banned/list, /banned/:banId, /ban-ip) before /:id.

export const usersRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List users with search/role/status filters and sorting.',
        input: { query: listQuery, },
        handler: async ({ query, },) => {
            const result = await users.list(
                {
                    search: query.search,
                    role: query.role,
                    status: query.status,
                    sortBy: query.sortBy,
                    sortOrder: query.sortOrder,
                },
                { page: query.page, limit: query.limit, },
            );
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/banned/list', auth: 'admin',
        summary: 'List active bans.',
        input: { query: bansQuery, },
        handler: async ({ query, },) => {
            const result = await users.listBans({ page: query.page, limit: query.limit, },);
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    defineRoute({
        method: 'delete', path: '/banned/:banId', auth: 'admin',
        summary: 'Remove a ban by id.',
        input: { params: z.object({ banId: z.string(), },), },
        handler: async ({ params, audit, },) => {
            await users.removeBan(params.banId, audit(),);
            return { message: 'Ban removed', };
        },
    },),

    defineRoute({
        method: 'post', path: '/ban-ip', auth: 'admin',
        summary: 'Ban an IP address.',
        input: { body: banUserSchema, },
        handler: async ({ body, audit, },) => {
            if (!body.ipAddress) throw new AppError(400, 'BAD_REQUEST', 'IP address is required',);
            await users.banIp(body.ipAddress, { reason: body.reason, expiresAt: body.expiresAt, }, audit(),);
            return { message: 'IP address banned', };
        },
    },),

    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'Fetch a user with Patreon membership.',
        input: { params: idParams, },
        handler: ({ params, },) => users.getWithMembership(params.id,),
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a user (email/password credential).',
        input: { body: createUserSchema, },
        handler: async ({ body, audit, },) => {
            const user = await users.create(body, audit(),);
            return reply(user, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update a user.',
        input: { params: idParams, body: updateUserSchema, },
        handler: ({ params, body, audit, },) => users.update(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'post', path: '/:id/avatar', auth: 'admin',
        summary: 'Upload a user avatar (resized to 256×256 webp).',
        pre: [avatarUpload.single('avatar',),],
        input: { params: idParams, },
        handler: ({ params, req, audit, },) => {
            const file = req.file;
            if (!file) throw new AppError(400, 'BAD_REQUEST', 'No file uploaded',);
            return users.setAvatar(params.id, file.path, audit(),);
        },
    },),

    defineRoute({
        method: 'post', path: '/:id/password', auth: 'admin',
        summary: 'Set a user\'s password.',
        input: { params: idParams, body: z.object({ password: z.string().min(8,), },), },
        handler: async ({ params, body, audit, },) => {
            await users.setPassword(params.id, body.password, audit(),);
            return { message: 'Password updated', };
        },
    },),

    defineRoute({
        method: 'post', path: '/:id/ban', auth: 'admin',
        summary: 'Ban a user.',
        input: { params: idParams, body: banUserSchema, },
        handler: async ({ params, body, audit, },) => {
            await users.ban(params.id, { reason: body.reason, expiresAt: body.expiresAt, }, audit(),);
            return { message: 'User banned successfully', };
        },
    },),

    defineRoute({
        method: 'post', path: '/:id/unban', auth: 'admin',
        summary: 'Unban a user.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await users.unban(params.id, audit(),);
            return { message: 'User unbanned successfully', };
        },
    },),
];
