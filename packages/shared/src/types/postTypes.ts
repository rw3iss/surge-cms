/**
 * Post TYPES — what kind of content a post is (`posts.post_type`).
 *
 * The type is a signal: every type stores its body in the same content-block
 * system, but it picks
 *   - the admin EDITOR (`editor`): `blocks` = the content-block editor
 *     (optionally seeded with `defaultBlocks`), `live` = the live-show console,
 *     or any other key a site registers with its own editor component,
 *   - the public DISPLAY (`display`): `blocks` (the normal post body) or `live`,
 *   - the SAMPLE strategy for subscription-gated posts (`sampler`),
 *   - the icon + label shown on badges and in the "New post" picker.
 *
 * Built-ins: article (default), video, live, custom. A site adds its own with
 * `registerPostType()` (shared, so the server validates it and the SPA shows
 * it) and, for a bespoke editor, a component in
 * `packages/cms/src/components/admin/posts/types/<key>/` — discovered
 * automatically. A type with no editor component falls back to `custom`.
 */

/** A content block a new post of this type starts with. */
export interface PostTypeDefaultBlock {
    type: string;
    data?: Record<string, unknown>;
}

export interface PostTypeDefinition {
    /** `[a-z][a-z0-9_-]{1,31}` — stored in `posts.post_type`. */
    key: string;
    label: string;
    /** One line for the "New post" picker. */
    description?: string;
    /** SVG path data (24×24 viewBox, stroked) for badges and the picker. */
    icon: string;
    /** Which admin editor renders the Content section. */
    editor: 'blocks' | 'live' | (string & {});
    /** How the public post page renders the body. */
    display: 'blocks' | 'live' | (string & {});
    /** Blocks a NEW post (or an empty post switched to this type) starts with. */
    defaultBlocks?: PostTypeDefaultBlock[];
    /** Gated-post sample strategy key (server `POST_SAMPLERS`); default `article`. */
    sampler?: string;
    /** Defaults for `posts.type_settings` (per-type options). */
    settingsDefaults?: Record<string, unknown>;
    /** Shown in the "New post" picker (default true). */
    creatable?: boolean;
    /** Order in pickers (lower first). */
    order?: number;
}

/** Chat audience in a live room. */
export type LiveChatMode = 'off' | 'public' | 'members' | 'subscribers';

/** `type_settings` of a `live` post. */
export interface LivePostSettings {
    /** Record the stream to storage for watching later (default true). */
    archiveVideo: boolean;
    chatMode: LiveChatMode;
    reactionsEnabled: boolean;
    /** Streaming provider (100ms etc.) — not connected yet. */
    provider?: string | null;
    /** Provider room id once connected. */
    providerRoomId?: string | null;
}

/** Lifecycle of a live show. `ended` = `posts.live_ended_at` is set. */
export type LiveStatus = 'idle' | 'live' | 'paused' | 'ended';
