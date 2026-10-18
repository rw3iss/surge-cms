/**
 * Content-block templates: a named, reusable block SUBTREE bound to an entity
 * type, authored in the existing block editor. Modeled directly on
 * `mail_templates` / `mail_template_blocks` (an entity-owned, nestable block
 * tree resolved through the same `buildBlockTree` / `populateBlockStyles`
 * machinery).
 */
import type { BlockType, } from '../types/content';
import type { SlotBinding, } from './entityBlock';

/** How a `list` template renders its records (see `ContentBlockTemplate.listRender`). */
export type TemplateListRender = 'each' | 'once';
export const TEMPLATE_LIST_RENDERS: readonly TemplateListRender[] = ['each', 'once',];

/** A slot id: a letter, then letters/digits/underscores, 40 chars max. */
export const TEMPLATE_SLOT_ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/i;
/** Most slots one template may declare. */
export const MAX_TEMPLATE_SLOTS = 20;

/**
 * A data input a template exposes, filled by the block that USES the template
 * (`EntityBlockSettings.slots[id]`). A block inside the template (Gallery,
 * Posts) reads its data from a slot instead of its own query.
 */
export interface TemplateSlot {
    /** Identifier, `TEMPLATE_SLOT_ID_PATTERN`, unique within the template. */
    id: string;
    /** Optional display name (falls back to `id`). */
    label?: string;
    /** An entity type key (post, gallery_item, product, a custom type…). */
    entityType: string;
    /** true = a list of records; false = at most one. */
    array: boolean;
    /** Data used for this slot while EDITING the template (preview only).
     *  Absent = auto: the first record (non-array) or first 6 (array). */
    previewBinding?: SlotBinding;
}

/** A saved content-block template (metadata; the blocks live in
 *  `content_block_template_blocks`, see `ContentBlockTemplateBlock`). */
/** One place a template / component is referenced (a page, post, mail template or another template). */
export interface TemplateUsage {
    kind: 'page' | 'post' | 'mail_template' | 'template';
    id: string;
    title: string;
    /** How many blocks in that item reference it. */
    blocks: number;
}

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
    /** List mode only: `each` (default) = render the template once PER record;
     *  `once` = render it ONE time with the plural variable bound to every
     *  record (the singular variable = the first). See `templateRenderGroups`. */
    listRender?: TemplateListRender;
    /** Record ids used as the PREVIEW sample while editing this template in the
     *  admin (so `{{entity.field}}` resolves against real data). Empty/absent =
     *  auto-pick (single → first record; list → first N up to `maxRecords`). */
    sampleRecordIds?: string[];
    /** Data inputs the using block fills (see `TemplateSlot`). */
    slots?: TemplateSlot[];
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
    /** Read responses only: the bound entity type's template variable names
     *  (`EntityTypeDef.singularVar` / `pluralVar`), so the public site binds
     *  the SAME names the template editor preview and email do. Absent on a
     *  global component or an unknown type. */
    singularVar?: string;
    pluralVar?: string;
    /** Staff reads only: where this template / component is used. */
    usages?: TemplateUsage[];
    /** Staff list reads only: how many pages/posts/emails/templates use it. */
    usageCount?: number;
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
