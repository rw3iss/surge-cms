import { z, } from 'zod';
import type { DevCronGetResponse, DevCronListResponse, } from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import * as dev from '../services/dev';

export const devRoutes = [

    defineRoute({
        method: 'get', path: '/crons', auth: 'admin',
        summary: 'List all registered cron jobs.',
        handler: (): DevCronListResponse => dev.listCrons(),
    },),

    defineRoute({
        method: 'get', path: '/crons/:name', auth: 'admin',
        summary: 'Fetch a single cron job by name (null when unknown).',
        input: { params: z.object({ name: z.string(), },), },
        handler: ({ params, },): DevCronGetResponse => dev.getCron(params.name,),
    },),
];
