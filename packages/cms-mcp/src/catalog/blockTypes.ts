/**
 * BLOCK_TYPE_CATALOG — the authoritative, machine-readable description of every
 * content-block type: where its fields live (content vs settings), the exact
 * field set (name/type/required/enum/default), sensible defaults, page-only
 * flags, and wiring notes. Derived from the admin block editors
 * (packages/cms/src/components/admin/blocks/types/*) and the shared types
 * (packages/shared/src/types/{content,hero,blockStyle}.ts).
 *
 * This is what lets an agent author any block correctly. Exposed via the
 * `describe_block_types` tool and used to seed default block data.
 *
 * Container semantics:
 *  - 'content'  → the field(s) go in the block's rich-text `content` (HTML body).
 *  - 'settings' → the fields go in the block's `settings` object (pages) / `data`
 *                 bag (posts). The MCP maps to the right wire shape per target.
 */
import type { BlockType, } from '@rw/cms-shared';

export interface BlockFieldSpec {
    name: string;
    /** Human type hint: 'string' | 'number' | 'boolean' | 'string[]' | 'object' | 'array<…>' | 'enum'. */
    type: string;
    required?: boolean;
    enum?: string[];
    default?: unknown;
    description: string;
}

export interface BlockTypeSpec {
    type: BlockType;
    label: string;
    description: string;
    /** Where authored data lives. 'content' = HTML body; 'settings' = fields; 'both'. */
    container: 'content' | 'settings' | 'both';
    /** True for group/group_item — nesting is a pages-only feature. */
    pageOnly?: boolean;
    /** Legacy types kept for rendering old rows; not offered for new authoring. */
    deprecated?: boolean;
    /** For the rich-text body, what `content` should contain. */
    contentNote?: string;
    fields: BlockFieldSpec[];
    /** Default settings/data applied on creation. */
    defaults: Record<string, unknown>;
    /** Free-text hint on wiring this block (referenced ids, sub-shapes, etc.). */
    wiring?: string;
}

export const BLOCK_TYPE_CATALOG: BlockTypeSpec[] = [
    {
        type: 'rich_text',
        label: 'Rich Text',
        description: 'Formatted prose (headings, lists, links, emphasis). The primary text block.',
        container: 'content',
        contentNote: 'HTML string — sanitized server-side. Use semantic tags (<p>, <h2>, <ul>, <a>, <strong>).',
        fields: [],
        defaults: {},
    },
    {
        type: 'text',
        label: 'Plain Text',
        description: 'Legacy plain-text block. Prefer rich_text for new content.',
        container: 'content',
        contentNote: 'Plain or lightly-formatted text stored in content.',
        fields: [],
        defaults: {},
    },
    {
        type: 'html',
        label: 'Custom HTML',
        description: 'Raw HTML embed rendered verbatim (sanitized). For custom markup/widgets.',
        container: 'content',
        contentNote: 'Raw HTML string stored in content.',
        fields: [],
        defaults: {},
    },
    {
        type: 'image',
        label: 'Image',
        description: 'One or more images with per-image alt/caption/link and block-level layout.',
        container: 'settings',
        fields: [
            { name: 'images', type: 'array<ImageItem>', required: true, description: 'Images. Each ImageItem: { id (uuid), url, mediaId?, alt?, caption?, link?, allowMaximize?, fileName?, fileSize? }. Use upload_media/list_media to get url+mediaId.', },
            { name: 'direction', type: 'enum', enum: ['horizontal', 'vertical',], default: 'horizontal', description: 'Layout direction for multiple images.', },
            { name: 'itemMinWidth', type: 'string', description: 'CSS length (e.g. "200px").', },
            { name: 'itemMaxWidth', type: 'string', description: 'CSS length.', },
            { name: 'itemMinHeight', type: 'string', description: 'CSS length.', },
            { name: 'itemMaxHeight', type: 'string', description: 'CSS length.', },
        ],
        defaults: { images: [], direction: 'horizontal', },
        wiring: 'Populate an ImageItem.url from upload_media (also set mediaId). Set allowMaximize:true to enable a lightbox.',
    },
    {
        type: 'video',
        label: 'Video',
        description: 'A single video by URL or uploaded media, with size + playback options.',
        container: 'settings',
        fields: [
            { name: 'url', type: 'string', required: true, description: 'Video URL (uploaded media url or external).', },
            { name: 'mediaId', type: 'string', description: 'Media id when uploaded via upload_media.', },
            { name: 'maxWidth', type: 'number', description: 'Max width in px.', },
            { name: 'maxHeight', type: 'number', description: 'Max height in px.', },
            { name: 'autoplay', type: 'boolean', default: false, description: 'Autoplay on view.', },
            { name: 'loop', type: 'boolean', default: false, description: 'Loop playback.', },
            { name: 'fileName', type: 'string', description: 'Original filename (uploads).', },
            { name: 'fileSize', type: 'number', description: 'Byte size (uploads).', },
        ],
        defaults: { url: '', },
    },
    {
        type: 'document',
        label: 'Document',
        description: 'A downloadable document (PDF, etc.) by URL or uploaded media.',
        container: 'settings',
        fields: [
            { name: 'url', type: 'string', required: true, description: 'Document URL.', },
            { name: 'fileName', type: 'string', description: 'Display filename.', },
            { name: 'fileSize', type: 'number', description: 'Byte size.', },
            { name: 'mimeType', type: 'string', description: 'MIME type.', },
            { name: 'mediaId', type: 'string', description: 'Media id when uploaded.', },
        ],
        defaults: { url: '', },
    },
    {
        type: 'url_link',
        label: 'URL Link',
        description: 'A link card with an unfurled preview (title/description/image).',
        container: 'settings',
        fields: [
            { name: 'url', type: 'string', required: true, description: 'Target URL.', },
            { name: 'title', type: 'string', description: 'Preview title.', },
            { name: 'description', type: 'string', description: 'Preview description.', },
            { name: 'image', type: 'string', description: 'Preview image URL.', },
            { name: 'siteName', type: 'string', description: 'Preview site name.', },
        ],
        defaults: { url: '', },
        wiring: 'Call the url_preview tool with the url to auto-fill title/description/image/siteName.',
    },
    {
        type: 'hero',
        label: 'Hero / Carousel',
        description: 'Full-width hero or multi-slide carousel with media, headings, and a CTA. (Block types "hero" and "carousel" share the HeroCarouselSettings shape.)',
        container: 'settings',
        fields: [
            { name: 'items', type: 'array<HeroItem>', required: true, description: 'Slides. Each HeroItem: { id, mediaId, mediaUrl, mediaThumbnailUrl?, mediaType: "image"|"video", objectFit: "cover"|"contain"|"fill"|"none"|"scale-down", autoplay?, header?: {text,size:"h1".."h6",color}, subheader?: {…}, action?: {label,url,openInNewTab,size?:"small"|"normal"|"large"}, order }.', },
            { name: 'options', type: 'object', required: true, description: 'HeroCarouselOptions: { autoScroll, autoScrollInterval (ms), repeat, customHeight, height (CSS), applyGutter? }.', },
        ],
        defaults: {
            items: [],
            options: { autoScroll: false, autoScrollInterval: 5000, repeat: true, customHeight: false, height: '480px', },
        },
        wiring: 'Get media via upload_media/list_media for each slide (mediaId + mediaUrl). One item = a static hero; multiple items = a carousel.',
    },
    {
        type: 'carousel',
        label: 'Carousel',
        description: 'Alias of hero using the same HeroCarouselSettings shape; use hero.',
        container: 'settings',
        fields: [
            { name: 'items', type: 'array<HeroItem>', required: true, description: 'See hero.', },
            { name: 'options', type: 'object', required: true, description: 'See hero.', },
        ],
        defaults: {
            items: [],
            options: { autoScroll: true, autoScrollInterval: 5000, repeat: true, customHeight: false, height: '480px', },
        },
    },
    {
        type: 'post_list',
        label: 'Posts',
        description: 'A curated and/or queried list of posts with rich display controls.',
        container: 'settings',
        fields: [
            { name: 'pinnedPostIds', type: 'string[]', description: 'Hand-picked post ids, rendered first (use list_posts to find ids).', },
            { name: 'queryEnabled', type: 'boolean', default: true, description: 'Enable the dynamic query beyond pinned posts.', },
            { name: 'count', type: 'number', default: 10, description: 'How many posts to fetch (1-100).', },
            { name: 'brevity', type: 'enum', enum: ['brief', 'short', 'full',], default: 'short', description: 'Render verbosity.', },
            { name: 'shortMaxHeight', type: 'string', description: 'CSS max-height when brevity="short".', },
            { name: 'allowExpand', type: 'boolean', description: 'Show a "See all" control for clipped short posts.', },
            { name: 'showExcerpt', type: 'boolean', description: 'Show excerpts.', },
            { name: 'showDateCreated', type: 'boolean', description: 'Show created date.', },
            { name: 'showDateUpdated', type: 'boolean', description: 'Show updated date.', },
            { name: 'showTags', type: 'boolean', description: 'Show tags.', },
            { name: 'query', type: 'string', description: 'Free-text search filter.', },
            { name: 'afterDaysAgo', type: 'number', description: 'Only posts older than N days (0 = no filter).', },
            { name: 'beforeDaysAgo', type: 'number', description: 'Only posts newer than N days ago.', },
            { name: 'showEmptyMessage', type: 'boolean', description: 'Show a message when the list is empty.', },
        ],
        defaults: { queryEnabled: true, count: 10, brevity: 'short', },
    },
    {
        type: 'campaign',
        label: 'Campaign',
        description: 'Embed a single fundraising campaign, or all campaigns.',
        container: 'settings',
        fields: [
            { name: 'campaignId', type: 'string', required: true, description: 'A campaign id (from list_campaigns) OR the literal "__all-campaigns__" for all.', },
            { name: 'title', type: 'string', description: 'Optional override label.', },
            { name: 'slug', type: 'string', description: 'Optional slug hint.', },
            { name: 'sortBy', type: 'string', description: 'When "__all-campaigns__": created_at | start_date | end_date | current_amount_cents | donation_percent | goal_amount_cents | donor_count.', },
            { name: 'sortOrder', type: 'enum', enum: ['asc', 'desc',], description: 'Sort direction for the all-campaigns list.', },
            { name: 'direction', type: 'enum', enum: ['vertical', 'horizontal',], description: 'Layout for the all-campaigns list.', },
        ],
        defaults: {},
        wiring: 'Requires the "campaigns" feature enabled. Use list_campaigns for ids.',
    },
    {
        type: 'form',
        label: 'Form',
        description: 'Embed a form/survey/poll by id.',
        container: 'settings',
        fields: [
            { name: 'formId', type: 'string', required: true, description: 'A form id (from list_forms).', },
            { name: 'title', type: 'string', description: 'Optional override title.', },
            { name: 'slug', type: 'string', description: 'Optional slug hint.', },
        ],
        defaults: {},
        wiring: 'Requires the "forms" feature enabled. Use list_forms for ids.',
    },
    {
        type: 'social',
        label: 'Social',
        description: 'A social feed or hand-picked social posts for a provider.',
        container: 'settings',
        fields: [
            { name: 'provider', type: 'enum', enum: ['instagram', 'facebook', 'tiktok', 'youtube', 'twitter',], required: true, description: 'Social provider.', },
            { name: 'items', type: 'array<SocialItem>', description: 'Pinned slots. Each: { id, postId?, postUrl?, thumbnailUrl?, content?, authorName? }. Empty = auto-feed.', },
            { name: 'count', type: 'number', default: 6, description: 'Number of slots (1-50).', },
            { name: 'layout', type: 'string', description: 'grid | 2-col | 1-col | row.', },
            { name: 'showComments', type: 'boolean', description: 'Show comments where supported.', },
        ],
        defaults: { provider: 'instagram', items: [], count: 6, },
        wiring: 'Use list_social_posts for pinned post ids. Auto-feed requires a connected social account.',
    },
    {
        type: 'group',
        label: 'Group',
        description: 'A flex/grid container holding child blocks in slots. PAGES ONLY. Creating a group auto-creates `columns` group_item slots; place a child block by setting its parentBlockId to a group_item id.',
        container: 'settings',
        pageOnly: true,
        fields: [
            { name: 'direction', type: 'enum', enum: ['horizontal', 'vertical',], default: 'horizontal', description: 'Flex direction.', },
            { name: 'columns', type: 'number', default: 2, description: 'Number of columns / initial group_item slots (1-16).', },
            { name: 'gap', type: 'string', description: 'CSS gap between slots.', },
            { name: 'wrap', type: 'enum', enum: ['wrap', 'nowrap',], description: 'Flex wrap.', },
            { name: 'align', type: 'enum', enum: ['start', 'center', 'end', 'stretch',], description: 'Cross-axis alignment.', },
            { name: 'justify', type: 'enum', enum: ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly',], description: 'Main-axis distribution.', },
            { name: 'itemMinWidth', type: 'string', description: 'CSS length applied to slots.', },
            { name: 'itemMaxWidth', type: 'string', description: 'CSS length.', },
            { name: 'itemMinHeight', type: 'string', description: 'CSS length.', },
            { name: 'itemMaxHeight', type: 'string', description: 'CSS length.', },
        ],
        defaults: { direction: 'horizontal', columns: 2, },
        wiring: 'add_page_block with type "group" returns the group id + the created group_item slot ids. Then add_page_block each child with parentBlockId = a slot id (each slot holds ONE child).',
    },
    {
        type: 'group_item',
        label: 'Group Slot',
        description: 'A single slot inside a group, holding at most one child block. PAGES ONLY. Normally auto-created with a group; rarely created directly.',
        container: 'settings',
        pageOnly: true,
        fields: [
            { name: 'width', type: 'string', description: 'CSS length.', },
            { name: 'minWidth', type: 'string', description: 'CSS length.', },
            { name: 'maxWidth', type: 'string', description: 'CSS length.', },
            { name: 'height', type: 'string', description: 'CSS length.', },
            { name: 'minHeight', type: 'string', description: 'CSS length.', },
            { name: 'maxHeight', type: 'string', description: 'CSS length.', },
            { name: 'alignSelf', type: 'enum', enum: ['start', 'center', 'end', 'stretch',], description: 'Per-slot cross-axis alignment.', },
        ],
        defaults: {},
    },
    {
        type: 'spacer',
        label: 'Spacer',
        description: 'Vertical whitespace of a fixed height.',
        container: 'settings',
        fields: [
            { name: 'height', type: 'string', default: '60px', description: 'CSS height of the gap.', },
        ],
        defaults: { height: '60px', },
    },
    {
        type: 'post',
        label: 'Single Post (legacy)',
        description: 'Deprecated single-post embed. Use post_list with one pinned id instead.',
        container: 'settings',
        deprecated: true,
        fields: [],
        defaults: {},
    },
    {
        type: 'gallery',
        label: 'Gallery (legacy)',
        description: 'Deprecated multi-image gallery. Use the image block (multi-image) instead.',
        container: 'settings',
        deprecated: true,
        fields: [],
        defaults: {},
    },
];

const CATALOG_BY_TYPE = new Map(BLOCK_TYPE_CATALOG.map((s,) => [s.type, s,],),);

export function getBlockSpec(type: string,): BlockTypeSpec | undefined {
    return CATALOG_BY_TYPE.get(type as BlockType,);
}

/** Block types offered for new authoring (excludes deprecated). */
export function authorableBlockTypes(): BlockType[] {
    return BLOCK_TYPE_CATALOG.filter((s,) => !s.deprecated,).map((s,) => s.type,);
}

/** A fresh copy of a type's default settings/data. */
export function defaultBlockData(type: string,): Record<string, unknown> {
    const spec = getBlockSpec(type,);
    return spec ? structuredClone(spec.defaults,) : {};
}
