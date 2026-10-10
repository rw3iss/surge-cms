/**
 * /api/v1/comments — the Comments feature: per-item switches (Enable
 * commenting / Allow anonymous / Lock) and the feature's settings. Comment
 * CRUD is in the engine: /api/v1/discussions.
 */
import { z, } from 'zod';
import type { CommentsSettingsBody, CommentsThreadUpdateBody, } from '@sitesurge/types';
import { NotFoundError, } from '../core/errors';
import { defineRoute, } from '../api/defineRoute';
import * as commentsSettings from '../services/comments/settings';
import * as threads from '../services/comments/threads';
import '../services/comments/targets';
import { allTargets, viewerOf, } from '../services/discussions';
import * as permissions from '../services/permissions';

const threadBody = z.object({
    enabled: z.boolean().optional(), allowAnonymous: z.boolean().optional(), locked: z.boolean().optional(),
},) satisfies z.ZodType<CommentsThreadUpdateBody>;

const threadParams = z.object({ targetType: z.string().regex(/^[a-z_][a-z0-9_]*$/,), targetId: z.string().uuid(), },);

/** Only types this feature attaches comments to (not forum threads). */
function assertCommentType(type: string,): void {
    if (!allTargets().some((t,) => t.type === type && t.feature === 'comments')) throw new NotFoundError('Comments',);
}

export const commentsRoutes = [
    defineRoute({
        method: 'get', path: '/threads/:targetType/:targetId', auth: 'optional',
        summary: 'An item\'s comment switches + count (defaults when never set).',
        input: { params: threadParams, },
        handler: ({ params, },) => {
            assertCommentType(params.targetType,);
            return threads.get(params.targetType, params.targetId,);
        },
    },),

    defineRoute({
        method: 'put', path: '/threads/:targetType/:targetId', auth: 'staff',
        summary: 'Set an item\'s Enable commenting / Allow anonymous / Lock switches.',
        input: {
            params: threadParams,
            body: threadBody,
        },
        handler: async ({ params, body, user, },) => {
            assertCommentType(params.targetType,);
            await permissions.requirePermission(viewerOf(user,), 'comments:manage',);
            return threads.update(params.targetType, params.targetId, body,);
        },
    },),

    defineRoute({
        method: 'get', path: '/settings', auth: 'staff',
        summary: 'Comments settings (approval, reply emails, default for new items).',
        handler: () => commentsSettings.getSettings(),
    },),

    defineRoute({
        method: 'put', path: '/settings', auth: 'staff',
        summary: 'Update the Comments settings.',
        input: {
            body: z.object({
                approveAnonymous: z.boolean().optional(),
                approveAll: z.boolean().optional(),
                notifyOnReply: z.boolean().optional(),
                enableByDefault: z.boolean().optional(),
            },) satisfies z.ZodType<CommentsSettingsBody>,
        },
        handler: async ({ body, user, audit, },) => {
            await permissions.requirePermission(viewerOf(user,), 'comments:manage',);
            return commentsSettings.updateSettings(body, audit(),);
        },
    },),
];
