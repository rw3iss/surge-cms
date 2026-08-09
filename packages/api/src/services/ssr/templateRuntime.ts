/**
 * Server-side runtime for the `{{ … }}` content template engine, used by the
 * SSR body builders so crawlers/JS-disabled visitors see resolved content
 * instead of raw braces. Mirrors the client runtime
 * (`packages/cms/src/services/template/runtime.ts`) but resolves entities via
 * the backend services (no HTTP) and flattens whole-entity segments to plain
 * HTML strings (SSR output is a string — no interactive components).
 *
 * The SSR context is anonymous (a crawler): `user` is null, so `{{user.*}}`
 * resolves to nothing — which is correct for SEO.
 */
import {
    entityRef,
    hasTemplateSyntax,
    renderTemplateToString,
    resolveValueFunction,
    type TemplateRuntime,
    UNRESOLVED,
} from '@sitesurge/types';
import { logger } from '../../utils/logger';
import * as campaignsSvc from '../campaigns';
import * as formsSvc from '../forms';
import * as mediaSvc from '../media';
import * as pagesSvc from '../pages';
import * as postsSvc from '../posts';
import * as entitiesSvc from '../entities';
import * as entityManager from '../../entities/entityManager';
import { escapeHtml } from './blocks/_util';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Rec = Record<string, unknown>;

async function fetchEntity(kind: string, ref: string): Promise<Rec | null> {
    const byId = UUID_RE.test(ref);
    try {
        switch (kind) {
            case 'post':
                return ((byId ? await postsSvc.getById(ref) : await postsSvc.getBySlug(ref)) as Rec | null)
                    ?? ((byId ? await postsSvc.getBySlug(ref) : await postsSvc.getById(ref)) as Rec | null);
            case 'campaign':
                return ((byId ? await campaignsSvc.getById(ref) : await campaignsSvc.getBySlug(ref)) as Rec | null)
                    ?? ((byId ? await campaignsSvc.getBySlug(ref) : await campaignsSvc.getById(ref)) as Rec | null);
            case 'form':
                return ((byId ? await formsSvc.getById(ref) : await formsSvc.getBySlug(ref)) as Rec | null)
                    ?? ((byId ? await formsSvc.getBySlug(ref) : await formsSvc.getById(ref)) as Rec | null);
            case 'page':
                return ((byId ? await pagesSvc.getById(ref) : await pagesSvc.getBySlug(ref)) as Rec | null)
                    ?? ((byId ? await pagesSvc.getBySlug(ref) : await pagesSvc.getById(ref)) as Rec | null);
            case 'media':
                return byId ? ((await mediaSvc.getById(ref)) as unknown as Rec) : null;
            default:
                // Generic fallback: any registered entity type (custom OR core
                // like `user`) resolves through the generic entity service.
                return (await entitiesSvc.get(kind, ref, { admin: false }).catch(() => null)) as Rec | null;
        }
    } catch {
        return null;
    }
}

async function fetchCollection(name: string, limit: number): Promise<{ kind: string; items: Rec[]; total: number }> {
    try {
        switch (name) {
            case 'posts': {
                const r = await postsSvc.listPublic({}, { limit }) as { data?: unknown[]; meta?: { total?: number } };
                const items = (r.data ?? []) as Rec[];
                return { kind: 'post', items, total: r.meta?.total ?? items.length };
            }
            case 'campaigns': {
                const items = (await campaignsSvc.listPublic({ limit } as never)) as unknown as Rec[];
                return { kind: 'campaign', items, total: items.length };
            }
            case 'forms': {
                const items = (await formsSvc.listPublished()) as unknown as Rec[];
                return { kind: 'form', items: items.slice(0, limit), total: items.length };
            }
            default: {
                // Generic fallback: match a registered type by its plural var.
                await entityManager.ready();
                const t = entityManager.all().find((x) => x.pluralVar === name || `${x.key}s` === name);
                if (!t) return { kind: '', items: [], total: 0 };
                const r = await entitiesSvc.list(t.key, { limit }, { admin: false });
                return { kind: t.key, items: r.items as unknown as Rec[], total: r.total };
            }
        }
    } catch {
        return { kind: '', items: [], total: 0 };
    }
}

/** Resolve the effective title for an entity given its `title` render option:
 *  `false`/`''` → hidden; a non-empty string → override; otherwise the entity's
 *  own title. Returns null when the title should not render. */
function optionTitle(own: string, options?: Record<string, unknown>): string | null {
    const t = options?.title;
    if (t === false || t === '') return null;
    if (typeof t === 'string') return t;
    return own || null;
}

/** Serialize a whole entity to indexable SSR HTML (SEO cares about words + links,
 *  not interactivity — forms/etc. are rendered client-side on mount). */
function entityToHtml(kind: string, data: Rec | null, options?: Record<string, unknown>): string {
    if (!data) return '';
    const g = (k: string): string => escapeHtml(String(data[k] ?? ''));
    switch (kind) {
        case 'post':
            return `<a class="ssr-entity ssr-entity--post" href="/posts/${g('slug')}"><h3>${g('title')}</h3>`
                + (data.excerpt ? `<p>${g('excerpt')}</p>` : '') + '</a>';
        case 'campaign':
        case 'campaignLink':
            return `<a class="ssr-entity ssr-entity--campaign" href="/campaigns/${g('slug')}"><h3>${g('title')}</h3>`
                + (data.shortDescription ? `<p>${g('shortDescription')}</p>` : '') + '</a>';
        case 'form': {
            const title = optionTitle(String(data.title ?? ''), options,);
            return '<div class="ssr-entity ssr-entity--form">'
                + (title ? `<h3>${escapeHtml(title,)}</h3>` : '')
                + (data.description ? `<p>${g('description')}</p>` : '') + '</div>';
        }
        case 'page':
            return `<a class="ssr-entity ssr-entity--page" href="/${g('slug')}">${g('title')}</a>`;
        case 'media': {
            const url = g('url');
            return String(data.mimeType ?? '').startsWith('video')
                ? `<video class="ssr-entity ssr-entity--media" src="${url}" controls></video>`
                : `<img class="ssr-entity ssr-entity--media" src="${url}" alt="${g('alt')}" />`;
        }
        case 'user':
            return escapeHtml(String((data.displayName ?? data.name) ?? ''));
        default: {
            // Generic entity (custom type, no bespoke serializer): emit a title
            // + a short indexable field dump so crawlers see real words.
            const title = g('title') || g('name') || g('slug');
            const body = Object.entries(data)
                .filter(([k, v]) => typeof v === 'string' && v && !['id', 'slug', 'title', 'name'].includes(k))
                .slice(0, 3)
                .map(([, v]) => `<p>${escapeHtml(String(v))}</p>`)
                .join('');
            return title
                ? `<div class="ssr-entity ssr-entity--${escapeHtml(kind)}"><h3>${title}</h3>${body}</div>`
                : '';
        }
    }
}

function buildSsrRuntime(entities: Record<string, Rec | null>): TemplateRuntime {
    const cache = new Map<string, Promise<unknown>>();
    const memo = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
        let p = cache.get(key) as Promise<T> | undefined;
        if (!p) { p = fn(); cache.set(key, p); }
        return p;
    };

    const context: Record<string, unknown> = {};
    for (const [name, data] of Object.entries(entities)) {
        if (data) context[name] = entityRef(name, data, String(data.id ?? data.slug ?? ''));
    }

    const s = (v: unknown): string => (v == null ? '' : String(v));

    const resolve = async (name: string, args: unknown[]): Promise<unknown> => {
        // Shared value/utility functions (upper, formatDate, default, now, …).
        const vf = resolveValueFunction(name, args);
        if (vf !== UNRESOLVED) return vf;

        switch (name) {
            case 'post':
            case 'campaign':
            case 'form':
            case 'page':
            case 'media': {
                const ref = s(args[0]).trim();
                if (!ref) return entityRef(name, null);
                const data = await memo(`${name}:${ref}`, () => fetchEntity(name, ref));
                return entityRef(name, data, ref);
            }
            case 'user':
                return entityRef('user', null);
            case 'campaignLink': {
                const ref = s(args[0]).trim();
                if (!ref) return entityRef('campaignLink', null);
                const data = await memo(`campaign:${ref}`, () => fetchEntity('campaign', ref));
                return entityRef('campaignLink', data, ref);
            }
            case 'posts':
            case 'campaigns':
            case 'forms': {
                const limit = typeof args[0] === 'number' ? (args[0] as number) : 20;
                const { kind, items } = await memo(`${name}:${limit}`, () => fetchCollection(name, limit));
                return items.map((it) => entityRef(kind, it, s(it.id ?? it.slug)));
            }
            case 'postCount': return (await memo('postCount', () => fetchCollection('posts', 1))).total;
            case 'campaignCount': return (await memo('campaignCount', () => fetchCollection('campaigns', 200))).total;
            case 'formCount': return (await memo('formCount', () => fetchCollection('forms', 200))).total;
            default: {
                // Generic entity fallback for any registered type.
                await entityManager.ready();
                const plural = entityManager.all().find((x) => x.pluralVar === name || `${x.key}s` === name);
                if (plural) {
                    const limit = typeof args[0] === 'number' ? (args[0] as number) : 20;
                    const { kind, items } = await memo(`${name}:${limit}`, () => fetchCollection(name, limit));
                    return items.map((it) => entityRef(kind, it, s(it.id ?? it.slug)));
                }
                if (entityManager.getType(name)) {
                    const ref = s(args[0]).trim();
                    if (!ref) return entityRef(name, null);
                    const data = await memo(`${name}:${ref}`, () => fetchEntity(name, ref));
                    return entityRef(name, data, ref);
                }
                return undefined;
            }
        }
    };

    return { context, resolve, warn: (m) => logger.debug?.(m) };
}

/**
 * Resolve `{{ … }}` in a block/content string to a plain HTML string for SSR.
 * Fast-paths content with no template syntax. Never throws — on any failure the
 * original content is returned so SSR never breaks.
 */
export async function resolveContentForSsr(
    content: string | null | undefined,
    entities: Record<string, Rec | null> = {},
): Promise<string> {
    if (!content || !hasTemplateSyntax(content)) return content ?? '';
    try {
        const rt = buildSsrRuntime(entities);
        return await renderTemplateToString(content, rt, (kind, data, options) => entityToHtml(kind, data, options));
    } catch (e) {
        logger.warn('SSR template resolution failed', { error: (e as Error).message });
        return content;
    }
}
