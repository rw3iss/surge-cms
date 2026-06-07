/**
 * Wire DTOs for the /mail-templates module (admin tier). Validation lives
 * in `packages/api/src/routes/mailTemplates.ts`; rendering + the variable
 * catalog in `packages/api/src/services/mailTemplates.ts` and
 * `services/mail/*`.
 *
 * Mail-template blocks have their OWN row shape (`templateId` / `blockType`
 * / `position`), distinct from the page/post `Block` entity
 * (`pageId` / `type` / `order`), so they are defined here rather than
 * reusing `Block`. The block INPUT (what the editor sends) and the block
 * ROW (what a fetched template carries) differ only in which fields are
 * required, so both are modeled below.
 *
 * `MailTemplate` and `VariableDescriptor` are reused verbatim from
 * `../../types/mail`.
 */

import type { MailTemplate, VariableDescriptor, } from '../../types/mail';

// ─── Block shapes ─────────────────────────────────────────────────────

/**
 * One mail-template block as it travels on the wire INTO the API (preview
 * body, blocks-replace body). `id` is optional — the editor may post
 * in-progress blocks before they have UUIDs. `style` may carry inline
 * CSS-token overrides OR a `{ id }` block-style-template ref (resolved
 * server-side before render).
 */
export interface MailTemplateBlockInput {
    id?: string;
    parentBlockId?: string | null;
    blockType: string;
    position: number;
    settings?: Record<string, unknown>;
    style?: Record<string, unknown>;
}

/**
 * One mail-template block as returned by GET /mail-templates/:id. Every
 * field is populated (the row exists in `mail_template_blocks`); `style`
 * is the raw stored value (a `{ id }` ref is NOT inlined on this path — it
 * is on the render/preview path). Mirrors `MailTemplateBlockRow` in
 * `repositories/mailTemplateBlocks.repo.ts`.
 */
export interface MailTemplateBlockRow {
    id: string;
    templateId: string;
    parentBlockId: string | null;
    blockType: string;
    position: number;
    settings: Record<string, unknown>;
    style: Record<string, unknown>;
}

// ─── GET /mail-templates/variables ────────────────────────────────────

/** GET /mail-templates/variables — the `{{path}}` token catalog the
 *  editor's reference panel renders. Bare array of descriptors. */
export type MailTemplateVariablesResponse = VariableDescriptor[];

// ─── GET /mail-templates ──────────────────────────────────────────────

/** GET /mail-templates — every template (meta only, no blocks). Bare
 *  array (no pagination meta). */
export type MailTemplateListResponse = MailTemplate[];

// ─── POST /mail-templates ─────────────────────────────────────────────

/** Body for POST /mail-templates (create). `fromEmail` / `replyTo` accept
 *  a valid email or the empty string. */
export interface MailTemplateCreateBody {
    name: string;
    description?: string;
    isEnabled?: boolean;
    subject?: string;
    preheader?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
}

/** POST /mail-templates (201) — the created template (meta only). */
export type MailTemplateCreateResponse = MailTemplate;

// ─── POST /mail-templates/preview ─────────────────────────────────────

/** Body for POST /mail-templates/preview. In-progress blocks may lack
 *  ids; `variables` are per-path sample overrides merged over the catalog
 *  defaults. */
export interface MailTemplatePreviewBody {
    blocks?: MailTemplateBlockInput[];
    subject?: string;
    preheader?: string;
    variables?: Record<string, string>;
}

/** POST /mail-templates/preview — rendered HTML plus the resolved
 *  subject/preheader and the set of `{{tokens}}` detected in the output. */
export interface MailTemplatePreviewResponse {
    html: string;
    subject: string;
    preheader?: string;
    detectedVariables: string[];
}

// ─── GET /mail-templates/:id ──────────────────────────────────────────

/** Params for the template-by-id family of routes. */
export interface MailTemplateIdParams {
    id: string;
}

/** GET /mail-templates/:id — template meta WITH its block tree (flat,
 *  ordered; the editor assembles the tree client-side). */
export type MailTemplateGetResponse = MailTemplate & {
    blocks: MailTemplateBlockRow[];
};

// ─── PUT /mail-templates/:id ──────────────────────────────────────────

/** Body for PUT /mail-templates/:id — metadata only (blocks go through
 *  the dedicated /blocks route). Every field optional (partial). */
export type MailTemplateUpdateBody = Partial<MailTemplateCreateBody>;

/** PUT /mail-templates/:id — the updated template (meta only). */
export type MailTemplateUpdateResponse = MailTemplate;

// ─── DELETE /mail-templates/:id ───────────────────────────────────────

/** DELETE /mail-templates/:id — `{ ok: true }`. */
export interface MailTemplateDeleteResponse {
    ok: true;
}

// ─── PUT /mail-templates/:id/blocks ───────────────────────────────────

/** Body for PUT /mail-templates/:id/blocks — the whole replacement block
 *  tree (flat list). Transactional: the old tree is dropped and this one
 *  inserted. `blocks` defaults to `[]` server-side, so it is optional on
 *  the wire (an absent value clears the tree). */
export interface MailTemplateBlocksReplaceBody {
    blocks?: MailTemplateBlockInput[];
}

/** PUT /mail-templates/:id/blocks — `{ ok: true }` plus the number of
 *  blocks written. */
export interface MailTemplateBlocksReplaceResponse {
    ok: true;
    count: number;
}
