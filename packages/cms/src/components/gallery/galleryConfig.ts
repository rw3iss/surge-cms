/**
 * The gallery's public route, loaded once per page load (the SPA needs it to
 * route a CUSTOM base URL through the `/:slug` catch-all). Viewer-specific
 * fields (`canView`) are NOT taken from here — pages fetch the config
 * themselves, keyed on the signed-in user.
 */
import type { GalleryPublicConfig, } from '@sitesurge/types';
import { cms, } from '../../services/cmsClient';
import { featureEnabledLoaded, } from '../../stores/siteSettings';

let pending: Promise<GalleryPublicConfig | null> | null = null;

export function loadGalleryRoute(): Promise<GalleryPublicConfig | null> {
    pending ??= featureEnabledLoaded('gallery',).then((on,) => (on ? cms.gallery.config().catch(() => null) : null));
    return pending;
}

/** `/photos` → `photos`. */
export const baseSlug = (baseUrl: string | null | undefined,): string => (baseUrl || '/gallery').replace(/^\/+|\/+$/g, '',).toLowerCase();
