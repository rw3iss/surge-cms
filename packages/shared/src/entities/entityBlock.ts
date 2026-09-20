/**
 * The `entity` content-block: renders a content-block template with an entity
 * (or list of entities) bound into the `{{ }}` template context. Its data
 * binding is a discriminated union covering the four sources an entity block
 * can draw from.
 */
import type { EntityQuery, } from './types';

/** How an `entity` block obtains the entity/entities it renders. */
export type EntityBinding =
    /**
     * Bind NOTHING — render the template once, as-is.
     *
     * For templates that don't reference an entity at all (a "latest video"
     * tout whose only block is a social feed, say). Every other mode resolves
     * records and renders nothing when it finds none, which is invisible and
     * indistinguishable from a broken block.
     */
    | { mode: 'none'; }
    /** Bind the current route/page entity (e.g. the post on a post page). */
    | { mode: 'context'; }
    /** A single specific entity by id or slug. */
    | { mode: 'single'; ref: string; }
    /** Specific entities by id/slug (≤ the template's maxRecords). */
    | { mode: 'list'; refs: string[]; }
    /** An open query resolved at render time. */
    | { mode: 'query'; query: EntityQuery; };

/** Settings payload for an `entity` block (and for a carousel `entity` item). */
export interface EntityBlockSettings {
    templateId: string;
    /** Cached from the template so the picker/preview knows the type without a
     *  round-trip; the template remains the source of truth. */
    entityType: string;
    binding: EntityBinding;
    /** How multiple resolved records lay out: a vertical `stack` (default) or a
     *  swipeable `carousel` (each record's rendered template is a slide). */
    layout?: 'stack' | 'carousel';
}
