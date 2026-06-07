import { z, } from 'zod';
import type { AssertCompatible, AuditListQuery, } from '@rw/cms-shared';
import { defineRoute, reply, } from '../api/defineRoute';
import * as audit from '../services/audit';

const listQuery = z.object({
    entityType: z.string().optional(),
    action: z.string().optional(),
    userId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    // Lenient like the legacy route: out-of-range page/limit are clamped
    // in the service (Math.max / Math.min) rather than rejected here.
    page: z.coerce.number().int().optional(),
    limit: z.coerce.number().int().optional(),
},);

// Query coerces (string → number), so assert z.infer compatibility.
type _AssertAuditListQuery = AssertCompatible<z.infer<typeof listQuery>, AuditListQuery>;

export const auditRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List audit-log entries with pagination and entity/action/user/date filters.',
        input: { query: listQuery, },
        handler: async ({ query, },) => {
            const result = await audit.list(query,);
            return reply(result.data, { meta: result.meta, },);
        },
    },),
];
