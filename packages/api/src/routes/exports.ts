/**
 * Data exports (`/api/v1/exports`) — any exportable admin table as a CSV
 * download (`?format=csv`) or a standalone printable page (`?format=print`,
 * `&columns=all` for every column). Same query params as the table it comes
 * from, so the export has the table's search / filter / sort; never paginated.
 *
 * GET routes on purpose: the admin opens them by NAVIGATION (a new tab for
 * print, a download for CSV), so the session cookie authenticates them and the
 * browser handles the file. Admin tier + the `data:export` permission.
 */
import type { Request, Response, } from 'express';
import { z, } from 'zod';
import { defineRoute, } from '../api/defineRoute';
import { ValidationError, } from '../core/errors';
import * as exportSources from '../services/export/sources';
import { sendCsv, sendPrint, } from '../services/export/formats';
import type { ExportDataset, } from '../services/export/dataset';
import * as permissions from '../services/permissions';
import { getPublicSettings, } from '../services/settings';

const common = {
    format: z.enum(['csv', 'print',],).default('csv',),
    columns: z.enum(['all', 'basic',],).optional(),
    search: z.string().max(200,).optional(),
    sortBy: z.string().max(64,).optional(),
    sortOrder: z.enum(['asc', 'desc',],).optional(),
};

async function deliver(
    res: Response,
    user: { id?: string; role?: string; } | undefined,
    q: { format: 'csv' | 'print'; columns?: 'all' | 'basic'; },
    build: () => Promise<ExportDataset>,
): Promise<void> {
    await permissions.requirePermission({ id: user?.id, role: user?.role, } as never, 'data:export',);
    const ds = await build();
    if (q.format === 'csv') return sendCsv(res, ds,);
    const site = await getPublicSettings().catch(() => ({ siteName: '', }),);
    sendPrint(res, ds, { siteName: site.siteName ?? '', allColumns: q.columns === 'all', },);
}

type H = { res: Response; req: Request; user?: { id?: string; role?: string; }; };

export const exportsRoutes = [
    defineRoute({
        method: 'get', path: '/campaigns/:id/donations', auth: 'admin', raw: true,
        summary: "Export a campaign's donations (same search/sort as its Donations table).",
        input: {
            params: z.object({ id: z.string().uuid(), },),
            query: z.object({ ...common, sortBy: z.enum(['name', 'email', 'amount', 'date', 'status',],).optional(), },),
        },
        handler: ({ params, query, res, user, }: H & { params: { id: string; }; query: z.infer<z.ZodObject<typeof common>>; },) =>
            deliver(res, user, query, () => exportSources.campaignDonations(params.id, query as never,),),
    },),

    defineRoute({
        method: 'get', path: '/mailing-lists/:id/subscribers', auth: 'admin', raw: true,
        summary: "Export a mailing list's subscribers (optional search/status, like its Subscribers table).",
        input: {
            params: z.object({ id: z.string().uuid(), },),
            query: z.object({ ...common, status: z.string().max(32,).optional(), },),
        },
        handler: ({ params, query, res, user, }: H & { params: { id: string; }; query: { format: 'csv' | 'print'; columns?: 'all' | 'basic'; search?: string; status?: string; }; },) =>
            deliver(res, user, query, () => exportSources.mailingListSubscribers(params.id, query,),),
    },),

    defineRoute({
        method: 'get', path: '/users', auth: 'admin', raw: true,
        summary: 'Export users (same search/role/status/sort as the Users table).',
        input: {
            query: z.object({ ...common, sortOrder: z.string().max(8,).optional(), role: z.string().max(32,).optional(), status: z.string().max(32,).optional(), subscription: z.string().max(64,).optional(), },),
        },
        handler: ({ query, res, user, }: H & { query: { format: 'csv' | 'print'; columns?: 'all' | 'basic'; search?: string; role?: string; status?: string; subscription?: string; sortBy?: string; sortOrder?: string; }; },) =>
            deliver(res, user, query, () => exportSources.allUsers(query,),),
    },),

    defineRoute({
        method: 'get', path: '/entities/:type', auth: 'admin', raw: true,
        summary: "Export any entity type's records (same search/status/filter/sort as its Data table; columns from the live schema).",
        input: {
            params: z.object({ type: z.string().regex(/^[a-z][a-z0-9_]*$/,), },),
            query: z.object({ ...common, status: z.string().max(32,).optional(), filter: z.string().max(4000,).optional(), },),
        },
        handler: ({ params, query, res, user, }: H & { params: { type: string; }; query: { format: 'csv' | 'print'; columns?: 'all' | 'basic'; search?: string; status?: string; sortBy?: string; sortOrder?: 'asc' | 'desc'; filter?: string; }; },) =>
            deliver(res, user, query, () => {
                let filter: unknown;
                if (query.filter) {
                    try {
                        filter = JSON.parse(query.filter,);
                    } catch {
                        throw new ValidationError('filter must be JSON (the same value the Data table sends).',);
                    }
                }
                return exportSources.entityRecords(params.type, { ...query, filter, },);
            },),
    },),
];
