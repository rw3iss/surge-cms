/**
 * /api/v1/discussions — the discussion engine (hidden `discussions` feature):
 * comment CRUD on any target, reactions, reports, moderation, engine settings.
 * Each target checks its own feature + item access (post, event, forum thread),
 * so these routes serve both Comments and the Forum.
 */
import { z, } from 'zod';
import type {
    CommentTargetRef, DiscussionsCommentCreateBody, DiscussionsModerationBulkBody, DiscussionsReactBody, DiscussionsReportBody,
    DiscussionsSettingsBody,
} from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import * as discussions from '../services/discussions';
import * as permissions from '../services/permissions';

const TARGET_RE = /^[a-z_][a-z0-9_]*:[0-9a-f-]{36}$/i;
const target = z.custom<CommentTargetRef>((v,) => typeof v === 'string' && TARGET_RE.test(v,), 'target must be "<type>:<uuid>"',);
const idParams = z.object({ id: z.string().uuid(), },);
const ACTIONS = ['approve', 'hide', 'delete', 'restore', 'dismiss_reports',] as const;

const listQuery = z.object({
    target,
    sort: z.enum(['newest', 'oldest', 'top',],).optional(),
    page: z.coerce.number().int().min(1,).optional(),
    limit: z.coerce.number().int().min(1,).max(100,).optional(),
},);

const createBody = z.object({
    target,
    parentId: z.string().uuid().nullish(),
    body: z.string().min(1,).max(50_000,),
    guestName: z.string().max(80,).optional(),
    guestEmail: z.string().max(255,).optional(),
    website: z.string().max(500,).optional(),
},) satisfies z.ZodType<DiscussionsCommentCreateBody>;

const moderationQuery = z.object({
    status: z.enum(['queue', 'pending', 'reported', 'hidden', 'deleted', 'visible', 'all',],).optional(),
    scope: z.enum(['all', 'comments', 'forum',],).optional(),
    target: target.optional(),
    authorId: z.string().uuid().optional(),
    search: z.string().max(200,).optional(),
    page: z.coerce.number().int().min(1,).optional(),
    limit: z.coerce.number().int().min(1,).max(100,).optional(),
},);

const settingsBody = z.object({
    reactionsEnabled: z.boolean().optional(),
    reactions: z.array(z.string().max(16,),).max(12,).optional(),
    maxLength: z.number().int().optional(),
    editWindowMinutes: z.number().int().min(0,).optional(),
},) satisfies z.ZodType<DiscussionsSettingsBody>;

const viewer = (user: { id?: string; role?: string; } | undefined,) => discussions.viewerOf(user,);

export const discussionsRoutes = [
    defineRoute({
        method: 'get', path: '/comments', auth: 'optional',
        summary: 'Comments on an item: top-level comments (paged) with their reply trees.',
        input: { query: listQuery, },
        handler: async ({ query, user, },) => {
            const r = await discussions.comments.list(query.target, viewer(user,), query,);
            return reply(r.items, { meta: { page: r.page, limit: r.limit, total: r.total, totalPages: Math.ceil(r.total / r.limit,), }, },);
        },
    },),

    defineRoute({
        method: 'post', path: '/comments', auth: 'optional',
        summary: 'Post a comment or reply (anonymous only where the item allows it).',
        input: { body: createBody, },
        handler: async ({ body, user, req, },) =>
            reply(await discussions.comments.create(body, viewer(user,), { ip: req.ip ?? null, },), { status: 201, },),
    },),

    defineRoute({
        method: 'put', path: '/comments/:id', auth: 'user',
        summary: 'Edit a comment (author within the edit window, or a moderator).',
        input: { params: idParams, body: z.object({ body: z.string().min(1,).max(50_000,), },), },
        handler: ({ params, body, user, },) => discussions.comments.update(params.id, body.body, viewer(user,),),
    },),

    defineRoute({
        method: 'delete', path: '/comments/:id', auth: 'user',
        summary: 'Delete a comment (soft: a comment with replies stays as "[deleted]").',
        input: { params: idParams, },
        handler: async ({ params, user, },) => {
            await discussions.comments.remove(params.id, viewer(user,),);
            return { deleted: true as const, };
        },
    },),

    defineRoute({
        method: 'post', path: '/comments/:id/reactions', auth: 'user',
        summary: 'Toggle one reaction on a comment.',
        input: { params: idParams, body: z.object({ kind: z.string().min(1,).max(16,), },) satisfies z.ZodType<DiscussionsReactBody>, },
        handler: ({ params, body, user, },) => discussions.moderation.react(params.id, body.kind, viewer(user,),),
    },),

    defineRoute({
        method: 'post', path: '/comments/:id/report', auth: 'user',
        summary: 'Report a comment to the moderators.',
        input: { params: idParams, body: z.object({ reason: z.string().max(1000,).optional(), },) satisfies z.ZodType<DiscussionsReportBody>, },
        handler: async ({ params, body, user, },) => {
            await discussions.moderation.report(params.id, body.reason, viewer(user,),);
            return { reported: true as const, };
        },
    },),

    defineRoute({
        method: 'get', path: '/comments/:id/history', auth: 'staff',
        summary: 'Edit history of a comment (moderators).',
        input: { params: idParams, },
        handler: ({ params, user, },) => discussions.comments.history(params.id, viewer(user,),),
    },),

    // ─── Moderation ───
    defineRoute({
        method: 'get', path: '/moderation', auth: 'staff',
        summary: 'Moderation queue (pending + reported by default), comments and forum posts.',
        input: { query: moderationQuery, },
        handler: async ({ query, user, },) => {
            const r = await discussions.moderation.list(query, viewer(user,),);
            return reply(r.items, { meta: { page: r.page, limit: r.limit, total: r.total, totalPages: Math.ceil(r.total / r.limit,), }, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/moderation/counts', auth: 'staff',
        summary: 'Pending + reported counts (admin badges).',
        handler: ({ user, },) => discussions.moderation.counts(viewer(user,),),
    },),

    defineRoute({
        method: 'post', path: '/moderation/bulk', auth: 'staff',
        summary: 'Apply one moderation action to many comments.',
        input: {
            body: z.object({ ids: z.array(z.string().uuid(),).min(1,).max(200,), action: z.enum(ACTIONS,), },) satisfies z.ZodType<DiscussionsModerationBulkBody>,
        },
        handler: ({ body, user, },) => discussions.moderation.bulk(body.ids, body.action, viewer(user,),),
    },),

    defineRoute({
        method: 'post', path: '/moderation/:id/:action', auth: 'staff',
        summary: 'Approve / hide / delete / restore a comment, or dismiss its reports.',
        input: { params: z.object({ id: z.string().uuid(), action: z.enum(ACTIONS,), },), },
        handler: ({ params, user, },) => discussions.moderation.act(params.id, params.action, viewer(user,),),
    },),

    // ─── Engine settings ───
    defineRoute({
        method: 'get', path: '/settings', auth: 'optional',
        summary: 'Engine settings (reactions, max length, edit window) — public: the composer needs them.',
        handler: () => discussions.getSettings(),
    },),

    defineRoute({
        method: 'put', path: '/settings', auth: 'admin',
        summary: 'Update engine settings.',
        input: { body: settingsBody, },
        handler: async ({ body, user, audit, },) => {
            await permissions.requirePermission(viewer(user,), 'discussions:moderate',);
            return discussions.updateSettings(body, audit(),);
        },
    },),
];
