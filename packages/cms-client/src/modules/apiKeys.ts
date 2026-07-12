import type {
    ApiKeyListResponse, ApiKeyCreateBody, ApiKeyCreateResponse, ApiKeyDeleteResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /api-keys namespace (all admin) — list/create/revoke. */
export class ApiKeysModule extends ModuleBase {
    protected readonly module = 'apiKeys';

    /** GET /api-keys — keys (hashes never returned). */
    list(): Promise<ApiKeyListResponse> {
        return this.get<ApiKeyListResponse>('/api-keys',);
    }

    /** POST /api-keys — the new key + its plaintext (returned once). */
    create(body: ApiKeyCreateBody,): Promise<ApiKeyCreateResponse> {
        return this.mutate<ApiKeyCreateResponse>('POST', '/api-keys', { body, invalidates: ['apiKeys',], },);
    }

    /** DELETE /api-keys/:id — revoke a key. */
    revoke(id: string,): Promise<ApiKeyDeleteResponse> {
        return this.mutate<ApiKeyDeleteResponse>('DELETE', '/api-keys/:id', { params: { id, }, invalidates: ['apiKeys',], },);
    }
}
