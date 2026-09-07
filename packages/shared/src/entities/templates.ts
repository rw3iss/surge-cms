/**
 * Content-block templates: a named, reusable block SUBTREE bound to an entity
 * type, authored in the existing block editor. Modeled directly on
 * `mail_templates` / `mail_template_blocks` (an entity-owned, nestable block
 * tree resolved through the same `buildBlockTree` / `populateBlockStyles`
 * machinery).
 */
import type { BlockType, } from '../types/content';

/** A saved content-block template (metadata; the blocks live in
 *  `content_block_template_blocks`, see `ContentBlockTemplateBlock`). */
export interface ContentBlockTemplate {
    id: string;
    name: string;
    description?: string;
    /** Bound entity type key; `null` = generic template (no entity variable). */
    entityTypeKey: string | null;
    /** Single entity vs an array — drives the bound variable name (singular
     *  vs plural) and the data-binding UI. */
    mode: 'single' | 'list';
    /** List mode only: cap on how many records a using block may bind/query. */
    maxRecords?: number | null;
    /** Record ids used as the PREVIEW sample while editing this template in the
     *  admin (so `{{entity.field}}` resolves against real data). Empty/absent =
     *  auto-pick (single → first record; list → first N up to `maxRecords`). */
    sampleRecordIds?: string[];
    /**
     * Optional client-side JS for this component, served as a same-origin ES
     * module at `/api/v1/components/:id/client.js` and mounted by the
     * `template` block:
     *
     *   export function mount(el, ctx) { … return () => cleanup }
     *
     * `ctx` gives `{ cms, user, settings, block }` — the CMS SDK, the signed-in
     * user (or null), public site settings, and the using block's settings.
     *
     * Served as a real file rather than inlined because CSP is
     * `script-src 'self'` with NO `'unsafe-inline'`: an inline <script> — and
     * an inline `onclick` — is blocked. Same-origin modules are not.
     */
    script?: string | null;
    /** Lets an operator switch off a misbehaving component's JS without
     *  deleting the code they're still working on. */
    scriptEnabled?: boolean;
    createdAt: string;
    updatedAt: string;
}

/** One block within a template's subtree. Mirrors `mail_template_blocks`. */
export interface ContentBlockTemplateBlock {
    id: string;
    templateId: string;
    parentBlockId: string | null;
    blockType: BlockType;
    position: number;
    settings: Record<string, unknown>;
    style: Record<string, unknown>;
}
