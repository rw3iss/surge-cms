/**
 * Generic replies (`/api/v1/replies`) — email a person who reached out, from
 * the admin. Thin manifest over `services/reply`; each source's own permission
 * (`campaigns.donations:reply`, `forms.submissions:reply`) is checked first.
 */
import { z, } from 'zod';
import type {
    ReplyComposeBody, ReplyPreviewResponse, ReplySendResponse, ReplySenderResponse, ReplyTargetBody, ReplyTargetResponse,
} from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import * as permissions from '../services/permissions';
import * as reply from '../services/reply';

const sourceParams = z.object({ source: z.enum(['donation', 'submission',],), },);
const ref = z.record(z.string(), z.string().max(64,),);
const compose = z.object({
    ref,
    templateId: z.string().uuid().nullable().optional(),
    subject: z.string().max(300,),
    message: z.string().max(20_000,),
    fromName: z.string().trim().max(200,).optional(),
    fromEmail: z.union([z.string().trim().email(), z.literal('',),],).optional(),
},) satisfies z.ZodType<ReplyComposeBody>;

const can = (user: { id?: string; role?: string; } | undefined, source: string,) =>
    permissions.requirePermission({ id: user?.id, role: user?.role, } as never, reply.permissionFor(source,),);

export const repliesRoutes = [
    defineRoute({
        method: 'get', path: '/sender', auth: 'staff',
        summary: 'The default sender a reply starts with (site default sender, else EMAIL_FROM).',
        handler: (): Promise<ReplySenderResponse> => reply.defaultSender(),
    },),

    defineRoute({
        method: 'post', path: '/:source/target', auth: 'staff',
        summary: 'The recipient, default subject/message and available {{ }} variables for a reply.',
        input: { params: sourceParams, body: z.object({ ref, },) satisfies z.ZodType<ReplyTargetBody>, },
        handler: async ({ params, body, user, },): Promise<ReplyTargetResponse> => {
            await can(user, params.source,);
            return reply.target(params.source, body.ref,);
        },
    },),

    defineRoute({
        method: 'post', path: '/:source/preview', auth: 'staff',
        summary: 'Render a reply exactly as it would be sent (no email is sent).',
        input: { params: sourceParams, body: compose, },
        handler: async ({ params, body, user, },): Promise<ReplyPreviewResponse> => {
            await can(user, params.source,);
            return reply.preview(params.source, body,);
        },
    },),

    defineRoute({
        method: 'post', path: '/:source/send', auth: 'staff',
        summary: "Email the reply. The recipient is the record's own stored address.",
        input: {
            params: sourceParams,
            body: compose.extend({ subject: z.string().trim().min(1,).max(300,), message: z.string().trim().min(1,).max(20_000,), },),
        },
        handler: async ({ params, body, user, audit, },): Promise<ReplySendResponse> => {
            await can(user, params.source,);
            return reply.send(params.source, body, audit(),);
        },
    },),
];
