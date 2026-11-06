/**
 * /api/v1/ai — the AI module (services/ai/). Staff tier + `ai:use`;
 * settings writes need `ai:manage`. Every answer is an `AiResult`.
 */
import { z, } from 'zod';
import type {
    AiCommentBody,
    AiJobQuery,
    AiJobsQuery,
    AiQueryBody,
    AiSessionsQuery,
    AiSettingsBody,
    AssertCompatible,
} from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import * as ai from '../services/ai';
import { viewerOf, } from '../services/discussions';
import * as permissions from '../services/permissions';

const provider = z.enum(['broker', 'anthropic',],);

const queryBody = z.object({
    prompt: z.string().min(1,).max(200_000,),
    system: z.string().max(50_000,).optional(),
    provider: provider.optional(),
    pool: z.string().max(64,).optional(),
    session: z.string().max(128,).optional(),
    format: z.enum(['text', 'json',],).optional(),
    wait: z.boolean().optional(),
    timeoutSec: z.number().int().min(1,).max(3600,).optional(),
    kind: z.string().max(40,).optional(),
    meta: z.record(z.string(), z.string().max(500,),).optional(),
    model: z.string().max(100,).optional(),
    maxTokens: z.number().int().min(1,).max(64000,).optional(),
},) satisfies z.ZodType<AiQueryBody>;

const sessionsQuery = z.object({
    pool: z.string().max(64,).optional(),
    all: z.coerce.boolean().optional(),
},);
type _AssertSessions = AssertCompatible<z.infer<typeof sessionsQuery>, AiSessionsQuery>;

const jobsQuery = z.object({
    status: z.string().max(100,).optional(),
    pool: z.string().max(64,).optional(),
    limit: z.coerce.number().int().min(1,).max(500,).optional(),
    all: z.coerce.boolean().optional(),
},);
type _AssertJobs = AssertCompatible<z.infer<typeof jobsQuery>, AiJobsQuery>;

const jobQuery = z.object({
    /** Long-poll up to N seconds for the job to settle. */
    wait: z.coerce.number().int().min(1,).max(600,).optional(),
},);
type _AssertJob = AssertCompatible<z.infer<typeof jobQuery>, AiJobQuery>;

const idParams = z.object({ id: z.string().min(1,).max(200,), },);

const commentBody = z.object({ note: z.string().min(1,).max(10_000,), },) satisfies z.ZodType<AiCommentBody>;

const settingsBody = z.object({
    defaultProvider: provider.optional(),
    anthropic: z.object({
        apiKey: z.string().max(500,).optional(),
        model: z.string().max(100,).optional(),
        maxTokens: z.number().int().min(1,).max(64000,).optional(),
    },).optional(),
},) satisfies z.ZodType<AiSettingsBody>;

/**
 * A waiting HTTP request returns within this many seconds (proxies such as
 * nginx close an idle upstream at 60 s). A job still running then comes back
 * `timedOut: true` — poll `GET /ai/jobs/:id?wait=…`. Server code calling
 * `ai.ask()` directly is not capped.
 */
const HTTP_WAIT_MAX_SEC = 55;

type Viewer = Parameters<typeof viewerOf>[0];
/**
 * `ai:use` / `ai:manage` for a signed-in staff member. An `ssk_` API key has
 * already passed its scope check in the `staff` tier (reads → read, writes →
 * write) and has no user to check — without this the SDK in API-key mode got
 * a 403 on every AI route.
 */
const allow = (key: 'ai:use' | 'ai:manage',) => async (user: Viewer, apiKey?: unknown,): Promise<void> => {
    if (apiKey && !user?.id) return;
    await permissions.requirePermission(viewerOf(user,), key,);
};
const use = allow('ai:use',);
const manage = allow('ai:manage',);

export const aiRoutes = [
    defineRoute({
        method: 'get', path: '/status', auth: 'staff',
        summary: 'Providers (available or why not), the broker plugin state and every pool\'s live status.',
        handler: async ({ user, apiKey, },) => {
            await use(user, apiKey,);
            return ai.status();
        },
    },),
    defineRoute({
        method: 'get', path: '/pools', auth: 'staff',
        summary: 'The broker pools: configured count vs attached / busy / idle sessions.',
        handler: async ({ user, apiKey, },) => {
            await use(user, apiKey,);
            return ai.pools();
        },
    },),
    defineRoute({
        method: 'get', path: '/sessions', auth: 'staff',
        summary: 'Broker sessions (attached unless `all`), optionally one pool\'s.',
        input: { query: sessionsQuery, },
        handler: async ({ query, user, apiKey, },) => {
            await use(user, apiKey,);
            return ai.sessions(query.pool, query.all,);
        },
    },),
    defineRoute({
        method: 'post', path: '/query', auth: 'staff',
        summary: 'Send a prompt to a provider (broker pool / session, or Anthropic). Waits (≤ 55 s) for the answer unless wait=false.',
        input: { body: queryBody, },
        handler: async ({ body, user, apiKey, },) => {
            await use(user, apiKey,);
            const timeoutSec = Math.min(body.timeoutSec ?? HTTP_WAIT_MAX_SEC, HTTP_WAIT_MAX_SEC,);
            return ai.query({ ...body, timeoutSec, meta: { ...(body.meta ?? {}), ...(user?.id ? { userId: user.id, } : {}), }, },);
        },
    },),
    defineRoute({
        method: 'get', path: '/jobs', auth: 'staff',
        summary: 'Recent broker jobs sent by the CMS (all jobs with `all`).',
        input: { query: jobsQuery, },
        handler: async ({ query, user, apiKey, },) => {
            await use(user, apiKey,);
            return ai.jobs(query,);
        },
    },),
    defineRoute({
        method: 'get', path: '/jobs/:id', auth: 'staff',
        summary: 'One broker job as an AiResult; `wait=N` long-polls until it settles.',
        input: { params: idParams, query: jobQuery, },
        handler: async ({ params, query, user, apiKey, },) => {
            await use(user, apiKey,);
            return ai.job(params.id, query.wait ? Math.min(query.wait, HTTP_WAIT_MAX_SEC,) : undefined,);
        },
    },),
    defineRoute({
        method: 'delete', path: '/jobs/:id', auth: 'staff',
        summary: 'Cancel a broker job.',
        input: { params: idParams, },
        handler: async ({ params, user, apiKey, },) => {
            await use(user, apiKey,);
            return ai.cancel(params.id,);
        },
    },),
    defineRoute({
        method: 'post', path: '/jobs/:id/comment', auth: 'staff',
        summary: 'Add a note to a running broker job (the session sees it).',
        input: { params: idParams, body: commentBody, },
        handler: async ({ params, body, user, apiKey, },) => {
            await use(user, apiKey,);
            return ai.comment(params.id, body.note,);
        },
    },),
    defineRoute({
        method: 'get', path: '/settings', auth: 'staff',
        summary: 'AI settings (the Anthropic key masked).',
        handler: async ({ user, apiKey, },) => {
            await manage(user, apiKey,);
            return ai.aiSettingsForAdmin();
        },
    },),
    defineRoute({
        method: 'put', path: '/settings', auth: 'staff',
        summary: 'Update the default provider / Anthropic key + model (an echoed mask keeps the key).',
        input: { body: settingsBody, },
        handler: async ({ body, user, apiKey, },) => {
            await manage(user, apiKey,);
            return ai.setAiSettings(body, user?.id ?? null,);
        },
    },),
];
