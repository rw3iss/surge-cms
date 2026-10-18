/**
 * Single source of truth for content blocks.
 *
 * Every other block-aware module (BlockEditor, ContentBlock,
 * BlockEditController, BlockPreview, etc.) imports from here. The
 * previous setup had three drifted copies of the type list:
 *   - BlockEditor.DEFAULT_BLOCK_TYPES (used by the "Add block" menu)
 *   - ContentBlock.BLOCK_TYPE_LABELS (used in hover bars)
 *   - BlockEditController._BLOCK_TYPE_LABELS (dead, marked unused)
 * This consolidates them so adding a new block type is a one-file
 * change.
 *
 * Forward look: a `composite: true` flag is reserved for the upcoming
 * "block group" feature where one block holds an ordered list of
 * child blocks (rows / columns / nested). Keep new fields opt-in so
 * existing call sites don't have to handle them.
 */

// `BlockType` is the single canonical union in `@sitesurge/types`
// (`packages/shared/src/types/content.ts`). It used to be re-declared here,
// which meant adding a block type required editing two lists in lockstep.
// We now import + re-export it so the many admin call sites that pull
// `BlockType` from this registry keep working, with ZERO drift risk.
import type { BlockType, } from '@sitesurge/types';
import { DEFAULT_GALLERY_BLOCK_SETTINGS, } from '@sitesurge/types';
export type { BlockType, };

/**
 * Categories used to group block types in the AddBlockMenu. The label
 * displayed for each category is set in the menu component itself so
 * this enum stays free of i18n concerns.
 */
export type BlockCategory = 'text' | 'media' | 'blocks' | 'layout';

/** Site-feature flag keys (mirror of SiteFeatures in @sitesurge/types). When
 *  a block type sets `gating`, it's only shown in the AddBlockMenu when
 *  that feature is enabled in site settings. */
export type BlockGatingFeature = 'posts' | 'campaigns' | 'forms' | 'messages' | 'users' | 'patreon' | 'gallery' | 'events';

/** Source of a "recent items" submenu, when applicable. The menu
 *  fetches the last N entries from this source on hover and lets the
 *  user pre-fill the new block with a specific item's id. */
export type RecentSource = 'campaigns' | 'forms' | 'posts';

export interface BlockTypeConfig {
    type: BlockType;
    /** User-facing label shown in the Add-block menu and hover bars. */
    label: string;
    /** Short hint shown alongside the label in pickers. Optional. */
    description?: string;
    /** Symbol/icon. Kept as a short string so we can swap to SVG later. */
    icon?: string;
    /** Menu category. Items without one are bucketed under "Other". */
    category?: BlockCategory;
    /** When set, the item is hidden from the menu unless the named
     *  site feature is enabled. */
    gating?: BlockGatingFeature;
    /** When set, the menu offers a submenu listing recent items of
     *  this kind. Picking one pre-fills the new block's id field. */
    recentSource?: RecentSource;
    /** Field on the block's `data` payload that receives the chosen
     *  recent item's id (e.g. 'campaignId', 'formId', 'postId'). */
    recentDataField?: string;
    /**
     * Factory that produces the initial `data` payload when this block
     * is added. Returning `{}` (the default) keeps the block in a
     * neutral state — block components should provide their own
     * defaults when rendering. The factory exists so block types that
     * NEED specific initial structure (e.g. a layout block with an
     * empty rows array) can declare it once here.
     */
    defaultData?: () => Record<string, unknown>;
    /**
     * When false, the block type is registered but hidden from the
     * "Add block" picker. Used to deprecate types without breaking
     * existing content.
     */
    enabled?: boolean;
    /**
     * Reserved for the upcoming "block group" feature. When true, the
     * block can contain child blocks (e.g. row/column groups). Today
     * no built-in block sets this; the editor doesn't render nested
     * blocks yet.
     */
    composite?: boolean;
}

/**
 * Default-padding behavior is shared across types. Any block listed
 * here gets `useDefaultPadding: false` on creation; everything else
 * defaults to true. Keeping the rule next to the type list (rather
 * than buried in BlockEditor.addBlock) makes it discoverable.
 */
const NO_DEFAULT_PADDING_TYPES: ReadonlySet<BlockType> = new Set(['carousel', 'hero',] as const,);

/**
 * Authoritative registry. Order here is the order shown in the
 * "Add block" menu.
 */
export const BLOCK_TYPES: BlockTypeConfig[] = [
    // ─── Text ─────────────────────────────────────────────
    { type: 'rich_text', label: 'Rich Text', icon: '¶', category: 'text', },
    { type: 'html', label: 'Custom HTML', icon: '<>', category: 'text', },
    { type: 'url_link', label: 'URL Link', icon: '🔗', category: 'text', },

    // ─── Media ────────────────────────────────────────────
    { type: 'image', label: 'Image', icon: '◧', category: 'media', },
    { type: 'video', label: 'Video', icon: '▶', category: 'media', },
    {
        type: 'gallery',
        label: 'Gallery',
        description: 'Items from the Gallery — picked, or a live query — as a grid, row, column, carousel or stage.',
        icon: '▦',
        category: 'media',
        gating: 'gallery',
        defaultData: () => structuredClone(DEFAULT_GALLERY_BLOCK_SETTINGS,) as unknown as Record<string, unknown>,
    },
    { type: 'document', label: 'Document', icon: '📄', category: 'media', },

    // ─── Blocks ───────────────────────────────────────────
    { type: 'hero', label: 'Hero Banner', icon: '✦', category: 'blocks', },
    { type: 'carousel', label: 'Carousel', icon: '⇄', category: 'blocks', },
    {
        type: 'post_list',
        label: 'Posts',
        icon: '☰',
        category: 'blocks',
        gating: 'posts',
        recentSource: 'posts',
        recentDataField: 'pinnedPostIds',
        defaultData: () => ({
            pinnedPostIds: [] as string[],
            queryEnabled: true,
            showEmptyMessage: true,
            count: 5,
            brevity: 'brief',
            shortMaxHeight: '400px',
            allowExpand: true,
            showExcerpt: true,
            showDateCreated: true,
            showDateUpdated: false,
            showTags: true,
            query: '',
        }),
    },
    {
        type: 'campaign',
        label: 'Campaign',
        icon: '$',
        category: 'blocks',
        gating: 'campaigns',
        recentSource: 'campaigns',
        recentDataField: 'campaignId',
    },
    {
        type: 'form',
        label: 'Form',
        icon: '☐',
        category: 'blocks',
        gating: 'forms',
        recentSource: 'forms',
        recentDataField: 'formId',
    },
    {
        type: 'event',
        label: 'Event',
        description: 'An event card — date and time, location, excerpt — linking to the event page.',
        icon: '📅',
        category: 'blocks',
        gating: 'events',
        defaultData: () => ({ showImage: true, showDescription: true, showLocation: true, }),
    },
    { type: 'social', label: 'Social', icon: '⌘', category: 'blocks', },
    {
        type: 'template',
        label: 'Component',
        description: 'Insert a reusable component — edit it once, every use updates.',
        icon: '❐',
        category: 'blocks',
        defaultData: () => ({ templateId: '', }),
    },
    {
        type: 'entity',
        label: 'Entity Template',
        description: 'Render a content-block template with an entity (or list) bound to it.',
        icon: '❖',
        category: 'blocks',
        defaultData: () => ({
            entity: { templateId: '', entityType: '', binding: { mode: 'context' } },
        }),
    },

    // ─── Layout ───────────────────────────────────────────
    {
        type: 'group',
        label: 'Group',
        icon: '⊞',
        category: 'layout',
        composite: true,
        defaultData: () => ({
            direction: 'horizontal',
            columns: 2,
            wrap: 'wrap',
        }),
    },
    { type: 'spacer', label: 'Empty Space', icon: '⎵', category: 'layout', },

    // ─── Hidden / legacy ──────────────────────────────────
    // 'text' is the legacy plain-text type; new content uses rich_text.
    { type: 'text', label: 'Text', enabled: false, },
    // 'post' (single embed) is removed in favor of the unified Posts block
    // (post_list). Existing rows render via a legacy fallback; the picker
    // doesn't surface it. ('gallery' was reused for the Gallery feature's block.)
    { type: 'post', label: 'Post Embed (legacy)', enabled: false, },
    // group_item is created automatically when a group is added or its
    // columns count changes — never picked from the menu directly.
    { type: 'group_item', label: 'Group Slot', enabled: false, composite: true, },
];

/** Ordered category keys + their display labels for the AddBlockMenu. */
export const MENU_CATEGORIES: Array<{ key: BlockCategory; label: string; }> = [
    { key: 'text', label: 'Text', },
    { key: 'media', label: 'Media', },
    { key: 'blocks', label: 'Blocks', },
    { key: 'layout', label: 'Layout', },
];

/** O(1) lookup by type, derived from BLOCK_TYPES. */
export const BLOCK_TYPE_MAP: Record<BlockType, BlockTypeConfig> = Object.fromEntries(
    BLOCK_TYPES.map((b,) => [b.type, b,]),
) as Record<BlockType, BlockTypeConfig>;

/** Block types shown in the "Add block" picker (i.e. enabled !== false). */
export function getEnabledBlockTypes(): BlockTypeConfig[] {
    return BLOCK_TYPES.filter((b,) => b.enabled !== false,);
}

/**
 * The minimal { type, label } pairs the legacy editor APIs expect.
 * Convenience for components that haven't migrated to the full config
 * shape yet — eventually those should consume BlockTypeConfig directly.
 */
export function getEnabledBlockTypeOptions(): Array<{ type: BlockType; label: string; }> {
    return getEnabledBlockTypes().map(({ type, label, },) => ({ type, label, }),);
}

export function getBlockLabel(type: BlockType,): string {
    return BLOCK_TYPE_MAP[type]?.label ?? String(type,);
}

/**
 * Human title for a block type — the configured label when known, else the
 * raw type title-cased (`group_item` → `Group Item`). Used for the edit-panel
 * heading; replaces the inline `.replace(/_/g,' ').replace(...)` that was
 * copy-pasted across the block editor.
 */
export function titleizeBlockType(type: string,): string {
    const label = BLOCK_TYPE_MAP[type as BlockType]?.label;
    if (label) return label;
    return String(type,).replace(/_/g, ' ',).replace(/\b\w/g, (c,) => c.toUpperCase(),);
}

/**
 * Initial `data` payload for a freshly-added block. Combines the
 * shared "default padding" rule with any type-specific factory.
 */
export function createBlockDefaultData(type: BlockType,): Record<string, unknown> {
    const config = BLOCK_TYPE_MAP[type];
    const base: Record<string, unknown> = {
        useDefaultPadding: !NO_DEFAULT_PADDING_TYPES.has(type,),
    };
    if (config?.defaultData) {
        return { ...base, ...config.defaultData(), };
    }
    return base;
}

type BlockData = Record<string, any>;

/** The generic "has content" check most simple block types use. */
function hasGenericContent(d: BlockData,): boolean {
    return Boolean(
        d.content || d.url || d.postId || d.postUrl || d.socialPlatform || d.platform || d.campaignId
            || d.formId || d.slug || d.galleryId || (d.items && d.items.length > 0)
            // Multi-image blocks store their images in `images[]`.
            || (Array.isArray(d.images,) && d.images.some((img: { url?: string; },) => img && img.url)),
    );
}

/**
 * Is a block configured enough to render its real preview (otherwise the
 * editor shows "Click edit to configure")? One arm per type — a
 * `Record<BlockType, …>`, so a new type fails to compile until it says.
 * This replaces a growing chain of special cases in BlockPreview, each added
 * after a configured block was stuck on the placeholder.
 */
export const BLOCK_CONFIGURED: Record<BlockType, (d: BlockData,) => boolean> = {
    // Always render: a spacer has its height; a post list always queries.
    spacer: () => true,
    post_list: () => true,
    // Configured once a component / template is chosen.
    template: (d,) => Boolean(d.templateId,),
    entity: (d,) => Boolean((d.entity as { templateId?: string; } | undefined)?.templateId,),
    // Auto-feed mode keeps its provider under `provider`.
    social: (d,) => Boolean(d.provider || d.platform || d.socialPlatform,),
    // A live query always has something to draw; "selected items" needs one.
    gallery: (d,) => !(d.source === 'items' && !(Array.isArray(d.itemIds,) && d.itemIds.length > 0)),
    hero: (d,) => Boolean(d.title || d.subtitle || d.content || d.backgroundImage,),
    rich_text: hasGenericContent,
    text: hasGenericContent,
    post: hasGenericContent,
    form: hasGenericContent,
    image: hasGenericContent,
    video: (d,) => hasGenericContent(d,) || Boolean(d.mediaId,),
    campaign: hasGenericContent,
    event: (d,) => hasGenericContent(d,) || Boolean(d.eventId,),
    html: hasGenericContent,
    document: hasGenericContent,
    url_link: hasGenericContent,
    carousel: hasGenericContent,
    group: hasGenericContent,
    group_item: hasGenericContent,
};

export function isBlockConfigured(type: string, data: BlockData | null | undefined,): boolean {
    const check = BLOCK_CONFIGURED[type as BlockType];
    return check ? check(data ?? {},) : hasGenericContent(data ?? {},);
}
