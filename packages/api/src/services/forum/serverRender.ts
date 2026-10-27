/**
 * Server side of the forum block and `{{ forum(...) }}` for the two backend
 * renderers (SSR + email). Both read as the ANONYMOUS visitor — a crawler and
 * an inbox are public — through the same feed the live widget uses
 * (`forumFeed`), so read rules, hidden categories and approval apply alike.
 *
 *   `resolveForumBlockItems` — a block's threads; the synchronous block
 *     emitters read them from `settings[FORUM_RESOLVED_KEY]`, stashed by the
 *     pre-pass (`mail/expandBlocks.ts`, also run by SSR).
 *   `resolveForumFunction`   — the template function, for
 *     `template/backendRuntime.ts` → `entityRef(FORUM_BLOCK_KIND, { settings, items })`.
 *
 * Never throws: the feature off, a missing table or a bad query → no threads.
 */
import {
    entityRef, FORUM_BLOCK_KIND, type ForumFeedThread, forumBlockSettingsFrom, forumFeedQueryFor, normalizeForumBlockSettings,
    type ResolvedForumBlockSettings, UNRESOLVED,
} from '@sitesurge/types';
import type { AsyncMemo, } from '../template/backendRuntime';

/** Settings key the pre-pass stashes a forum block's threads under. */
export const FORUM_RESOLVED_KEY = '__forumItems';

const ANON = { id: null, role: null, };

/** A forum block's threads for the anonymous reader (opening posts dropped — the renderers use the excerpt). */
export async function resolveForumBlockItems(settings: unknown,): Promise<ForumFeedThread[]> {
    try {
        const s = normalizeForumBlockSettings(settings,);
        if (s.mode === 'thread' && !s.thread) return [];
        // Lazy: the feed pulls in the discussions engine, which most pages never need.
        const { forumFeed, } = await import('./feed.js');
        const { postCategory: _p, ...q } = forumFeedQueryFor(s,);
        const r = await forumFeed(q, ANON,);
        return r.items.map((t,) => ({ ...t, opening: null, }));
    } catch {
        return [];
    }
}

/** The stashed threads on a block's settings. */
export function resolvedForumItemsOf(settings: Record<string, unknown> | null | undefined,): ForumFeedThread[] {
    const v = settings?.[FORUM_RESOLVED_KEY];
    return Array.isArray(v,) ? (v as ForumFeedThread[]) : [];
}

/** Data of a `forum(...)` entity ref. */
export interface ForumFunctionData {
    settings: ResolvedForumBlockSettings;
    items: ForumFeedThread[];
}

/** Resolve `forum(...)`, or UNRESOLVED when `name` is not it. */
export async function resolveForumFunction(
    name: string, args: unknown[], named: Record<string, unknown> | undefined, memo: AsyncMemo,
): Promise<unknown> {
    const raw = forumBlockSettingsFrom(name, args, named ?? {},);
    if (!raw) return UNRESOLVED;
    const settings = normalizeForumBlockSettings(raw,);
    const items = await memo(`forum:${JSON.stringify(raw,)}`, () => resolveForumBlockItems(raw,),);
    const data: ForumFunctionData = { settings, items, };
    return entityRef(FORUM_BLOCK_KIND, data as unknown as Record<string, unknown>,);
}
