/**
 * Sent-mail archive (`/api/v1/mail-archive`, feature `mailing_lists`).
 * Access + personalisation rules live in `services/mail/archive.ts`.
 */
import { z, } from 'zod';
import type { MailArchiveListQuery, MailArchiveViewQuery, } from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import { isStaffRole, } from '@sitesurge/types';
import * as archive from '../services/mail/archive';

const listQuery = z.object({
    page: z.coerce.number().int().min(1,).optional(),
    limit: z.coerce.number().int().min(1,).max(50,).optional(),
},);
type _A = z.infer<typeof listQuery> extends MailArchiveListQuery ? true : never;
const _a: _A = true;
void _a;

export const mailArchiveRoutes = [
    defineRoute({
        method: 'get', path: '/', auth: 'public',
        summary: 'Sent mails of lists with a public archive, newest first.',
        input: { query: listQuery, },
        handler: async ({ query, },) => {
            const page = query.page ?? 1;
            const limit = query.limit ?? 20;
            const { data, total, } = await archive.listPublicArchive(page, limit,);
            return reply(data, { meta: { page, limit, total, totalPages: Math.ceil(total / limit,), }, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/:jobId', auth: 'optional',
        summary: 'One sent mail as a web page, resolved for the viewer (signed ?r= recipient token, else the signed-in user).',
        input: {
            params: z.object({ jobId: z.string().uuid(), },),
            query: z.object({ r: z.string().max(200,).optional(), },) satisfies z.ZodType<MailArchiveViewQuery>,
        },
        handler: ({ params, query, user, },) =>
            archive.viewSentMail(params.jobId, {
                token: query.r,
                viewer: user
                    ? { id: user.id, role: user.role, email: user.email, displayName: user.displayName, staff: isStaffRole(user.role,), }
                    : null,
            },),
    },),
];
