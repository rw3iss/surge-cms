import type {
    BlockStyleListResponse, BlockStyleGetResponse, BlockStyleCreateBody, BlockStyleCreateResponse,
    BlockStyleUpdateBody, BlockStyleUpdateResponse, BlockStyleDeleteResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /block-styles namespace (all admin) — reusable block-style templates.
 * Mounted at '/block-styles' (kebab) on the API; the cache-namespace
 * identity is the camel 'blockStyles'.
 */
export class BlockStylesModule extends ModuleBase {
    protected readonly module = 'blockStyles';

    /** GET /block-styles — all templates. */
    list(): Promise<BlockStyleListResponse> {
        return this.get<BlockStyleListResponse>('/block-styles',);
    }

    /** GET /block-styles/:id — one template. */
    getById(id: string,): Promise<BlockStyleGetResponse> {
        return this.get<BlockStyleGetResponse>('/block-styles/:id', { params: { id, }, },);
    }

    create(body: BlockStyleCreateBody,): Promise<BlockStyleCreateResponse> {
        return this.mutate<BlockStyleCreateResponse>('POST', '/block-styles', { body, invalidates: ['blockStyles',], },);
    }

    update(id: string, body: BlockStyleUpdateBody,): Promise<BlockStyleUpdateResponse> {
        return this.mutate<BlockStyleUpdateResponse>('PUT', '/block-styles/:id', { params: { id, }, body, invalidates: ['blockStyles',], },);
    }

    remove(id: string,): Promise<BlockStyleDeleteResponse> {
        return this.mutate<BlockStyleDeleteResponse>('DELETE', '/block-styles/:id', { params: { id, }, invalidates: ['blockStyles',], },);
    }
}
