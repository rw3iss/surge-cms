import { z, } from 'zod';
import { API_KEY_SCOPES, } from '@rw/shared';
import { ForbiddenError, NotFoundError, } from '../core/errors';
import { defineRoute, reply, } from '../api/defineRoute';
import * as apiKeys from '../services/apiKeys';

const createSchema = z.object({
    name: z.string().min(1,).max(100,),
    scopes: z.array(z.enum(API_KEY_SCOPES,),).min(1,).default(['read',],),
},);

/** Keys must not mint or revoke keys — management requires a real
 *  admin login. */
function rejectKeyAuth(apiKey: unknown,): void {
    if (apiKey) throw new ForbiddenError('API-key management requires an admin login',);
}

export const apiKeysRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List API keys (hashes never returned).',
        handler: ({ apiKey, },) => {
            rejectKeyAuth(apiKey,);
            return apiKeys.list();
        },
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create an API key. The plaintext key is returned ONCE in this response.',
        input: { body: createSchema, },
        handler: async ({ body, audit, apiKey, },) => {
            rejectKeyAuth(apiKey,);
            const { apiKey: created, plaintextKey, } = await apiKeys.create(body, audit(),);
            return reply({ apiKey: created, key: plaintextKey, }, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Revoke an API key (soft — sets revoked_at).',
        input: { params: z.object({ id: z.string().uuid(), },), },
        handler: async ({ params, audit, apiKey, },) => {
            rejectKeyAuth(apiKey,);
            const revoked = await apiKeys.revoke(params.id, audit(),);
            if (!revoked) throw new NotFoundError('API key',);
            return revoked;
        },
    },),
];
