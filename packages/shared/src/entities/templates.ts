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
