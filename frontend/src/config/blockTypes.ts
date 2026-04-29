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

export type BlockType =
    | 'text'
    | 'social_media'
    | 'image'
    | 'video'
    | 'document'
    | 'url_link'
    | 'rich_text'
    | 'hero'
    | 'html'
    | 'campaign'
    | 'form'
    | 'post'
    | 'post_list'
    | 'social_feed'
    | 'gallery'
    | 'carousel'
    | 'spacer'
    | 'group'
    | 'group_item';

/** Loose grouping for future menu organization. Flat for now. */
export type BlockCategory = 'content' | 'media' | 'embed' | 'layout' | 'reference';

export interface BlockTypeConfig {
    type: BlockType;
    /** User-facing label shown in the Add-block menu and hover bars. */
    label: string;
    /** Short hint shown alongside the label in pickers. Optional. */
    description?: string;
    /** Symbol/icon. Kept as a short string so we can swap to SVG later. */
    icon?: string;
    /** Loose category, for future grouped pickers. */
    category?: BlockCategory;
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
    { type: 'rich_text', label: 'Rich Text', icon: '¶', category: 'content', },
    { type: 'image', label: 'Image', icon: '◧', category: 'media', },
    { type: 'video', label: 'Video', icon: '▶', category: 'media', },
    { type: 'hero', label: 'Hero Banner', icon: '✦', category: 'layout', },
    { type: 'html', label: 'Custom HTML', icon: '<>', category: 'content', },
    { type: 'social_media', label: 'Social Media Post', icon: '@', category: 'embed', },
    { type: 'social_feed', label: 'Social Feed', icon: '⌘', category: 'embed', },
    { type: 'campaign', label: 'Campaign', icon: '$', category: 'reference', },
    { type: 'form', label: 'Form', icon: '☐', category: 'reference', },
    { type: 'post', label: 'Post Embed', icon: '📰', category: 'reference', },
    {
        type: 'post_list',
        label: 'Post List',
        icon: '☰',
        category: 'reference',
        // Sensible defaults: query enabled with 5 posts, brief mode,
        // all meta fields shown, no specific posts, empty-message
        // placeholder on. Specific posts and the query render
        // independently — see PostListRenderer.
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
    { type: 'gallery', label: 'Gallery', icon: '⊟', category: 'reference', },
    { type: 'document', label: 'Document', icon: '📄', category: 'media', },
    { type: 'url_link', label: 'URL Link', icon: '🔗', category: 'embed', },
    { type: 'carousel', label: 'Carousel', icon: '⇄', category: 'layout', },
    { type: 'spacer', label: 'Empty Space', icon: '⎵', category: 'layout', },
    {
        type: 'group',
        label: 'Group',
        icon: '⊞',
        category: 'layout',
        composite: true,
        // A new group starts with two columns. The PageEditor / save
        // flow picks up this default and creates two empty group_item
        // children alongside the group itself.
        defaultData: () => ({
            direction: 'horizontal',
            columns: 2,
            wrap: 'wrap',
        }),
    },
    // 'text' is the legacy plain-text type; new content uses rich_text.
    // We keep the label so existing rows render correctly but don't
    // expose it in the picker (enabled: false).
    { type: 'text', label: 'Text', enabled: false, },
    // group_item is created automatically when a group is added or its
    // columns count changes — never picked from the menu directly.
    { type: 'group_item', label: 'Group Slot', enabled: false, composite: true, },
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
