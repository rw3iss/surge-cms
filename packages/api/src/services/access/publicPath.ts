/**
 * Validate the public route of a feature that lives at a configurable path
 * (the events calendar, the gallery): one path segment, not a built-in route
 * (`RESERVED_PUBLIC_PATHS`, except the feature's own default) and not an
 * existing page's slug — mounting one at `/shop` would silently break the
 * storefront, which is very hard to diagnose after the fact.
 */
import { RESERVED_PUBLIC_PATHS, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';

export async function validatePublicBasePath(raw: string, opts: { label: string; ownDefault: string; },): Promise<string> {
    const url = `/${(raw || '').trim().replace(/^\/+|\/+$/g, '',)}`;
    if (url === '/') throw new ValidationError(`The ${opts.label} URL cannot be the site root.`,);
    if (!/^\/[a-z0-9-]+$/i.test(url,)) {
        throw new ValidationError(`The ${opts.label} URL must be a single path segment, e.g. ${opts.ownDefault}.`,);
    }
    const lower = url.toLowerCase();
    if (RESERVED_PUBLIC_PATHS.includes(lower,) && lower !== opts.ownDefault) {
        throw new ValidationError(`${url} is a reserved route and cannot be used.`,);
    }
    const clash = await query<{ id: string; }>(
        `SELECT id FROM pages WHERE slug = $1 AND status <> 'deleted' LIMIT 1`,
        [url.slice(1,),],
    ).catch(() => null);
    if (clash?.rowCount) throw new ValidationError(`A page already exists at ${url}. Choose another path.`,);
    return url;
}
