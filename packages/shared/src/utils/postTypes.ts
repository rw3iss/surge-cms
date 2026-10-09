/**
 * The post-type REGISTRY (see `types/postTypes.ts`). Shared by the server
 * (validation, defaults, samplers) and the SPA (pickers, badges, editors).
 * Register a site's own type once, from code both sides load:
 *
 *   registerPostType({ key: 'announcement', label: 'Announcement', icon: '…',
 *                      editor: 'blocks', display: 'blocks',
 *                      defaultBlocks: [{ type: 'rich_text' }] });
 */
import type { PostTypeDefinition, } from '../types/postTypes';

export const DEFAULT_POST_TYPE = 'article';
export const CUSTOM_POST_TYPE = 'custom';
export const POST_TYPE_KEY_RE = /^[a-z][a-z0-9_-]{1,31}$/;

const ICONS = {
    // Document with lines.
    article: 'M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 16h6',
    // Play button in a frame.
    video: 'M4 5h16v14H4zM10 9l5 3-5 3z',
    // Tall phone-shaped frame with a play mark.
    short: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 9l4 3-4 3z',
    // Broadcast: dot with signal arcs.
    live: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8',
    // Building blocks.
    custom: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
};

export const BUILTIN_POST_TYPES: PostTypeDefinition[] = [
    {
        key: 'article', label: 'Article', description: 'A written story: one Rich Text block to start.',
        icon: ICONS.article, editor: 'blocks', display: 'blocks', sampler: 'article', order: 10,
        defaultBlocks: [{ type: 'rich_text', data: { content: '', }, },],
    },
    {
        key: 'video', label: 'Video', description: 'A video post: one Video block to start.',
        icon: ICONS.video, editor: 'blocks', display: 'blocks', sampler: 'video', order: 20,
        defaultBlocks: [{ type: 'video', data: {}, },],
    },
    {
        // Same as a video post (one Video block, video sampler) but classified
        // apart, so shorts can be filtered/placed separately (/posts filter,
        // newsletters, entity queries `post_type = short`).
        key: 'short', label: 'Short', description: 'A short (often vertical) video: one Video block to start.',
        icon: ICONS.short, editor: 'blocks', display: 'blocks', sampler: 'video', order: 25,
        defaultBlocks: [{ type: 'video', data: {}, },],
    },
    {
        key: 'live', label: 'Live Show', description: 'Stream live from your webcam, with chat and reactions.',
        icon: ICONS.live, editor: 'live', display: 'live', sampler: 'live', order: 30,
        settingsDefaults: { archiveVideo: true, chatMode: 'public', reactionsEnabled: true, provider: null, providerRoomId: null, },
    },
    {
        key: 'custom', label: 'Custom', description: 'Any content blocks, no starting layout.',
        icon: ICONS.custom, editor: 'blocks', display: 'blocks', sampler: 'article', order: 90,
        defaultBlocks: [],
    },
];

const registry = new Map<string, PostTypeDefinition>(BUILTIN_POST_TYPES.map((t,) => [t.key, t,],),);

/** Add (or replace) a post type. Throws on an invalid key. */
export function registerPostType(def: PostTypeDefinition,): void {
    if (!POST_TYPE_KEY_RE.test(def.key,)) throw new Error(`Invalid post type key "${def.key}"`,);
    registry.set(def.key, { creatable: true, ...def, },);
}

export function isPostType(key: string | null | undefined,): boolean {
    return !!key && registry.has(key,);
}

/** The definition for a key; unknown keys fall back to `custom`. */
export function getPostType(key: string | null | undefined,): PostTypeDefinition {
    return registry.get(key || DEFAULT_POST_TYPE,) ?? registry.get(CUSTOM_POST_TYPE,)!;
}

export function listPostTypes(): PostTypeDefinition[] {
    return [...registry.values(),].sort((a, b,) => (a.order ?? 50) - (b.order ?? 50));
}
