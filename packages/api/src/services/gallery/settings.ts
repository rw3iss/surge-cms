/** Gallery settings (`gallery_settings`) + the viewer-shaped public config. */
import {
    DEFAULT_GALLERY_APPEARANCE, DEFAULT_GALLERY_SETTINGS, type GalleryAppearance, type GalleryPublicConfig, type GallerySettings,
} from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import { cache, } from '../cache';
import { floorFor, refusalReason, viewerLevel, type LevelViewer, } from '../access/level';
import { validatePublicBasePath, } from '../access/publicPath';
import { tiersById, } from '../postGate';
import * as settingsService from '../settings';
import type { AuditContext, } from '../types';

export const SETTINGS_KEY = 'gallery_settings';

export async function getSettings(): Promise<GallerySettings> {
    const raw = await settingsService.get<Partial<GallerySettings>>(SETTINGS_KEY,).catch(() => null);
    return {
        ...DEFAULT_GALLERY_SETTINGS,
        ...(raw ?? {}),
        appearance: { ...DEFAULT_GALLERY_APPEARANCE, ...(raw?.appearance ?? {}), },
    };
}

/**
 * Refused inside a typed CSS value: anything that ends the declaration or the
 * rule, a comment, `url(` / `expression(` / `@import`, and a BACKSLASH — a CSS
 * escape such as `\75 rl(…)` decodes to `url(` in the browser, so a value
 * that looks harmless could still load a remote resource.
 */
export const UNSAFE_CSS = /[;{}<>"\\]|\/\*|url\s*\(|expression\s*\(|@import/i;

/** A CSS length/size typed by an editor — anything that could escape a declaration is refused. */
export function cssValue(v: unknown, label: string, max = 64,): string {
    const s = String(v ?? '',).trim();
    if (!s) return '';
    if (s.length > max || UNSAFE_CSS.test(s,)) throw new ValidationError(`${label} is not a valid CSS value.`,);
    return s;
}

const int = (v: unknown, min: number, max: number, label: string,): number => {
    const n = Math.round(Number(v,),);
    if (!Number.isFinite(n,) || n < min || n > max) throw new ValidationError(`${label} must be ${min}–${max}.`,);
    return n;
};

const oneOf = <T extends string,>(v: unknown, allowed: readonly T[], fallback: T,): T => (allowed.includes(v as T,) ? (v as T) : fallback);

function cleanAppearance(a: Partial<GalleryAppearance>,): GalleryAppearance {
    const d = DEFAULT_GALLERY_APPEARANCE;
    const n = { ...d, ...a, };
    return {
        layout: oneOf(n.layout, ['grid', 'masonry', 'carousel', 'stage',] as const, d.layout,),
        open: oneOf(n.open, ['lightbox', 'page', 'none',] as const, d.open,),
        thumbSize: int(n.thumbSize, 80, 800, 'Thumbnail size',),
        gap: cssValue(n.gap, 'Grid spacing',) || d.gap,
        aspect: oneOf(n.aspect, ['square', '4:3', '3:2', '16:9', 'original',] as const, d.aspect,),
        fit: oneOf(n.fit, ['cover', 'contain',] as const, d.fit,),
        radius: cssValue(n.radius, 'Corner radius',),
        gutter: oneOf(n.gutter, ['site', 'custom',] as const, d.gutter,),
        customGutter: cssValue(n.customGutter, 'Gutter',) || d.customGutter,
        padding: oneOf(n.padding, ['site', 'custom',] as const, d.padding,),
        customPadding: cssValue(n.customPadding, 'Page padding',) || d.customPadding,
        maxWidth: oneOf(n.maxWidth, ['site', 'custom',] as const, d.maxWidth,),
        customMaxWidth: cssValue(n.customMaxWidth, 'Max width',),
        showTitles: Boolean(n.showTitles,),
        showCaptions: Boolean(n.showCaptions,),
        hoverZoom: Boolean(n.hoverZoom,),
        perPage: int(n.perPage, 4, 200, 'Items per page',),
        videoBadge: Boolean(n.videoBadge,),
        showPublishedDate: Boolean(n.showPublishedDate,),
        thumbStrip: Boolean(n.thumbStrip,),
        showCollectionsSidebar: Boolean(n.showCollectionsSidebar,),
    };
}

export async function updateSettings(patch: Partial<GallerySettings>, ctx: AuditContext,): Promise<GallerySettings> {
    const cur = await getSettings();
    const n = { ...cur, ...patch, appearance: { ...cur.appearance, ...(patch.appearance ?? {}), }, };
    if (!['public', 'members', 'tier',].includes(n.access,)) throw new ValidationError('Unknown gallery access.',);
    if (n.access === 'tier') {
        if (!n.minTierId || !(await tiersById()).has(n.minTierId,)) throw new ValidationError('Choose the subscription tier the gallery requires.',);
    }
    const next: GallerySettings = {
        title: String(n.title ?? '',).trim().slice(0, 120,) || 'Gallery',
        description: String(n.description ?? '',).slice(0, 4000,),
        baseUrl: patch.baseUrl !== undefined && patch.baseUrl !== cur.baseUrl
            ? await validatePublicBasePath(patch.baseUrl, { label: 'gallery', ownDefault: '/gallery', },)
            : cur.baseUrl,
        access: n.access,
        minTierId: n.access === 'tier' ? n.minTierId : null,
        allowVideos: Boolean(n.allowVideos,),
        commentsEnabled: Boolean(n.commentsEnabled,),
        allowAnonymousComments: Boolean(n.allowAnonymousComments,),
        appearance: cleanAppearance(n.appearance,),
    };
    await settingsService.set(SETTINGS_KEY, next, ctx,);
    await cache.invalidateGalleryCache();
    await cache.invalidateSitemapCache();
    return next;
}

/** The gallery-wide floor as a level. */
export async function galleryFloor(s?: GallerySettings,): Promise<number> {
    const st = s ?? (await getSettings());
    return floorFor(st.access, st.minTierId,);
}

export async function publicConfig(viewer: LevelViewer,): Promise<GalleryPublicConfig> {
    const s = await getSettings();
    const [level, floor,] = await Promise.all([viewerLevel(viewer,), galleryFloor(s,),],);
    const tier = s.access === 'tier' && s.minTierId ? (await tiersById()).get(s.minTierId,) : undefined;
    return {
        title: s.title,
        description: s.description,
        baseUrl: s.baseUrl,
        allowVideos: s.allowVideos,
        appearance: s.appearance,
        canView: level >= floor,
        reason: refusalReason(level, floor,),
        requiredTier: tier ? { id: tier.id, name: tier.name, } : null,
    };
}
