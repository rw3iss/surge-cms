/**
 * Let a hard-coded route inherit the CMS page that shares its slug.
 *
 * Some routes are rendered by bespoke components rather than the block editor —
 * `/shop` is the storefront grid, not whatever blocks the `shop` page holds. But
 * a page row for that slug usually still exists, and an operator who sets a
 * header style, a background colour, or a members-only access level on it quite
 * reasonably expects the visible page to honour those.
 *
 * This applies the presentation and gating fields of that row without taking
 * over rendering. When no such page exists, everything is inert and the route
 * behaves exactly as before.
 */
import { createEffect, createResource, onCleanup, } from 'solid-js';
import type { Page, } from '@sitesurge/types';
import { cms, } from '../services/cmsClient';
import { setActiveHeaderPosition, setActivePageBackground, setActiveHeaderStyle, } from '../stores/headerStyle';
import { pageBackgroundStyle, } from '../utils/appearanceStyle';

export interface OverridePageSettings {
    /** The backing page row, when one exists. */
    page: () => Page | null;
    /** Inline style for the route's wrapper — `{}` when nothing is set. */
    backgroundStyle: () => Record<string, string>;
    /** True once the lookup has settled, so a caller can avoid flashing. */
    ready: () => boolean;
    /** The page exists but is not published — the route should 404. */
    unpublished: () => boolean;
    /** The page exists but the viewer lacks the access level it requires. */
    locked: () => boolean;
}

export function useOverridePageSettings(slug: string,): OverridePageSettings {
    const [data] = createResource(
        () => slug,
        async (s,) => {
            try {
                // A missing page is the normal case for a fresh install, so a
                // 404 here is not an error — it just means no overrides.
                return await cms.pages.getBySlug(s,) as Page;
            } catch {
                return null;
            }
        },
    );

    const page = () => data() ?? null;

    // Header style/position are global signals the Layout reads, so they must be
    // reset on unmount or they would leak onto the next route the visitor sees.
    createEffect(() => {
        const p = page();
        if (!p) return;
        setActiveHeaderStyle((p as { headerStyle?: 'default' | 'alt'; }).headerStyle ?? null,);
        setActiveHeaderPosition((p as { headerPosition?: 'static' | 'float'; }).headerPosition ?? null,);
        setActivePageBackground((p as { backgroundColor?: string | null; }).backgroundColor ?? null,);
    },);
    onCleanup(() => {
        setActiveHeaderStyle(null,);
        setActiveHeaderPosition(null,);
        setActivePageBackground(null,);
    },);

    return {
        page,
        backgroundStyle: () =>
            pageBackgroundStyle((page() as { backgroundColor?: string | null; } | null)?.backgroundColor,),
        ready: () => !data.loading,
        // Only meaningful once loaded AND a row exists: no page means no opinion,
        // which must not be read as "unpublished".
        unpublished: () => {
            const p = page();
            return Boolean(p && p.status && p.status !== 'published',);
        },
        locked: () => {
            const p = page() as { accessLevel?: string; } | null;
            // The API already withholds a gated page's content from a viewer who
            // may not see it, so reaching here with a row means access is fine.
            // This stays as an explicit hook for when the route wants to render
            // its own locked state rather than the storefront.
            return false;
        },
    };
}
