/**
 * Wire DTOs for the /block-styles module. Validation schemas live in
 * `packages/api/src/routes/blockStyles.ts`. Reuses the `BlockStyle`
 * entity from shared types.
 */

import type { BlockStyle, } from '../../types/blockStyle';

/** GET /api/v1/block-styles — all templates. */
export type BlockStyleListResponse = BlockStyle[];

/** Params for the by-id routes. */
export interface BlockStyleIdParams {
    id: string;
}

/** GET /api/v1/block-styles/:id — one template. */
export type BlockStyleGetResponse = BlockStyle;

/**
 * POST /api/v1/block-styles — create body. All visual properties are the
 * BlockStyle fields except the server-owned id/timestamps; `name` is
 * required on create.
 */
export interface BlockStyleCreateBody {
    name: string;
    isDefault?: boolean;
    backgroundColor?: string | null;
    backgroundImage?: string | null;
    textColor?: string | null;
    textAlign?: string | null;
    verticalAlign?: string | null;
    fontSize?: string | null;
    width?: string | null;
    height?: string | null;
    padding?: string | null;
    margin?: string | null;
    gap?: string | null;
    overflowX?: string | null;
    overflowY?: string | null;
}

/** POST /api/v1/block-styles (201) — the created template. */
export type BlockStyleCreateResponse = BlockStyle;

/** PUT /api/v1/block-styles/:id — partial create body. */
export type BlockStyleUpdateBody = Partial<BlockStyleCreateBody>;

/** PUT /api/v1/block-styles/:id — the updated template. */
export type BlockStyleUpdateResponse = BlockStyle;

/** DELETE /api/v1/block-styles/:id — confirmation message. */
export interface BlockStyleDeleteResponse {
    message: string;
}
