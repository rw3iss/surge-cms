/**
 * Scheduled sends for mailing lists.
 *
 * Mounted at /api/v1/mail-schedules (admin tier, gated on the `mailing_lists`
 * feature).
 *
 *   GET    /                  — all schedules, with list + template names
 *   GET    /timezone          — the site's authoring timezone, for form defaults
 *   POST   /                  — create
 *   GET    /:id               — fetch one
 *   PUT    /:id               — update
 *   PATCH  /:id/enabled       — pause / resume
 *   POST   /:id/run           — send now, out of band
 *   DELETE /:id               — remove
 *
 * Writes are gated on `mailing_lists:send`, not `:write`. A schedule is a
 * standing instruction to mail real subscribers — creating one is the same
 * act as pressing Send, only later, so it takes the same permission.
 *
 * Business logic lives in `services/mailSchedules.ts`.
 */
import { z, } from 'zod';
import { defineRoute, } from '../api/defineRoute';
import * as schedules from '../services/mailSchedules';
import * as permissions from '../services/permissions';

const FREQUENCIES = ['once', 'daily', 'weekly', 'monthly', 'yearly',] as const;

const scheduleSchema = z.object({
    name: z.string().min(1,).max(200,),
    listId: z.string().uuid(),
    templateId: z.string().uuid().nullish(),
    subject: z.string().max(500,).nullish(),
    preheader: z.string().max(500,).nullish(),
    fromName: z.string().max(200,).nullish(),
    fromEmail: z.string().max(200,).nullish(),
    replyTo: z.string().max(200,).nullish(),
    blocks: z.array(z.record(z.string(), z.unknown(),),).nullish(),
    frequency: z.enum(FREQUENCIES,),
    timeOfDay: z.string(),
    timezone: z.string().nullish(),
    startDate: z.string(),
    enabled: z.boolean().optional(),
},);

const idParams = z.object({ id: z.string().uuid(), },);

/** Creating, editing or firing a schedule all mail real people. */
const requireSend = (user: { id?: string; role?: string; } | undefined,) =>
    permissions.requirePermission({ id: user?.id, role: user?.role, }, 'mailing_lists:send',);

export const mailSchedulesRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List every scheduled send.',
        handler: () => schedules.list(),
    },),

    defineRoute({
        method: 'get', path: '/timezone', auth: 'admin',
        summary: "The site's authoring timezone, used to default a new schedule.",
        // Declared BEFORE /:id — Express matches in order, and a literal path
        // registered after a parameterised one is never reached.
        handler: async () => ({ timezone: await schedules.defaultTimezone(), }),
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a scheduled send.',
        input: { body: scheduleSchema, },
        handler: async ({ body, user, audit, },) => {
            await requireSend(user,);
            return schedules.create(body as never, audit(),);
        },
    },),

    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'Fetch one scheduled send.',
        input: { params: idParams, },
        handler: ({ params, },) => schedules.getById(params.id,),
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update a scheduled send.',
        input: { params: idParams, body: scheduleSchema, },
        handler: async ({ params, body, user, audit, },) => {
            await requireSend(user,);
            return schedules.update(params.id, body as never, audit(),);
        },
    },),

    defineRoute({
        method: 'patch', path: '/:id/enabled', auth: 'admin',
        summary: 'Pause or resume a scheduled send.',
        input: { params: idParams, body: z.object({ enabled: z.boolean(), },), },
        handler: async ({ params, body, user, audit, },) => {
            await requireSend(user,);
            return schedules.setEnabled(params.id, body.enabled, audit(),);
        },
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a scheduled send.',
        input: { params: idParams, },
        handler: async ({ params, user, audit, },) => {
            await requireSend(user,);
            await schedules.remove(params.id, audit(),);
            return { deleted: true, };
        },
    },),
];
