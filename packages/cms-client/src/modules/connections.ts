import type {
    ConnectionListResponse, ConnectionGetResponse, ConnectionUpsertBody, ConnectionUpsertResponse,
    ConnectionUpdateBody, ConnectionUpdateResponse, ConnectionDeleteResponse,
    ConnectionReorderBody, ConnectionReorderResponse, ConnectionOAuthAuthorizeResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /connections namespace (all admin) — social connection credentials +
 * settings, per-provider. The OAuth CALLBACK route is not exposed (raw
 * redirect); only the authorize-URL endpoint is.
 */
export class ConnectionsModule extends ModuleBase {
    protected readonly module = 'connections';

    /** GET /connections — all connections, credentials masked. */
    list(): Promise<ConnectionListResponse> {
        return this.get<ConnectionListResponse>('/connections',);
    }

    /** GET /connections/:provider — one connection, or null when none yet.
     *  Named `getByProvider` (not `get`) so it doesn't clash with the
     *  protected `get` request helper on ModuleBase. */
    getByProvider(provider: string,): Promise<ConnectionGetResponse> {
        return this.get<ConnectionGetResponse>('/connections/:provider', { params: { provider, }, },);
    }

    /** POST /connections — create/update a provider's creds + settings. */
    upsert(body: ConnectionUpsertBody,): Promise<ConnectionUpsertResponse> {
        return this.mutate<ConnectionUpsertResponse>('POST', '/connections', { body, invalidates: ['connections',], },);
    }

    /** PUT /connections/:provider — partial upsert (provider from path). */
    update(provider: string, body: ConnectionUpdateBody,): Promise<ConnectionUpdateResponse> {
        return this.mutate<ConnectionUpdateResponse>('PUT', '/connections/:provider', { params: { provider, }, body, invalidates: ['connections',], },);
    }

    /** DELETE /connections/:provider — disconnect (clears issued tokens). */
    remove(provider: string,): Promise<ConnectionDeleteResponse> {
        return this.mutate<ConnectionDeleteResponse>('DELETE', '/connections/:provider', { params: { provider, }, invalidates: ['connections',], },);
    }

    /** PUT /connections/:provider/reorder — move one slot up/down. */
    reorder(provider: string, body: ConnectionReorderBody,): Promise<ConnectionReorderResponse> {
        return this.mutate<ConnectionReorderResponse>('PUT', '/connections/:provider/reorder', { params: { provider, }, body, invalidates: ['connections',], },);
    }

    /** GET /connections/:provider/oauth/authorize — OAuth URL + CSRF state. */
    oauthAuthorize(provider: string,): Promise<ConnectionOAuthAuthorizeResponse> {
        return this.get<ConnectionOAuthAuthorizeResponse>('/connections/:provider/oauth/authorize', { params: { provider, }, },);
    }
}
