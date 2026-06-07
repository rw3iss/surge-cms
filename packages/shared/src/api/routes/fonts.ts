/**
 * Wire DTOs for the /fonts module. Validation/multipart handling lives
 * in `packages/api/src/routes/fonts.ts`.
 */

/**
 * An uploaded font, as returned with its @font-face source URL. Defined
 * here as the wire shape — the API package's repo carries `Date`
 * timestamps which serialize to ISO strings. The list endpoint enriches
 * each row with `url`.
 */
export interface Font {
    id: string;
    customId: string;
    originalName: string;
    fileName: string;
    format: string;
    sizeBytes: number;
    familyName?: string | null;
    createdAt: string;
    updatedAt: string;
}

/** A font enriched with the URL the browser fetches its binary from. */
export interface FontWithUrl extends Font {
    url: string;
}

/** GET /api/v1/fonts — all fonts with source URLs. */
export type FontListResponse = FontWithUrl[];

/**
 * POST /api/v1/fonts — multipart body (field "file"). These optional
 * text fields ride alongside the file part.
 */
export interface FontUploadBody {
    customId?: string;
    familyName?: string;
}

/** POST /api/v1/fonts (201) — the created font with its URL. */
export type FontUploadResponse = FontWithUrl;

/** DELETE /api/v1/fonts/:id — params. */
export interface FontDeleteParams {
    id: string;
}

/** DELETE /api/v1/fonts/:id — the deleted font row. */
export type FontDeleteResponse = Font;
