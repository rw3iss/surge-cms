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
 *
 * The memo/entity-lookup/collection plumbing + resolution core is shared with
 * the mail runtime via `services/template/backendRuntime.ts`; this file owns
 * only the SSR-specific serializer + the collections/counts/`user` resolvers.
 */
import {
    entityRef,
    hasTemplateSyntax,
    renderTemplateToString,
    type TemplateRuntime,
} from '@sitesurge/types';
import { logger, } from '../../utils/logger';
import * as entityManager from '../../entities/entityManager';
import { escapeHtml, } from './blocks/_util';
import {
    type AsyncMemo,
    buildBackendRuntime,
    fetchCollection,
    fetchEntity,
    type Rec,
} from '../template/backendRuntime';

/** Kinds resolved via the bespoke service dual-lookup (rest fall through to
 *  the generic entity service). */
const SSR_SINGLE_KINDS: ReadonlySet<string> = new Set([
    'post',
    'campaign',
    'event',
    'form',
    'page',
    'media',
]);

/** Resolve the effective title for an entity given its `title` render option:
 *  `false`/`''` → hidden; a non-empty string → override; otherwise the entity's
 *  own title. Returns null when the title should not render. */
function optionTitle(own: string, options?: Record<string, unknown>,): string | null {
    const t = options?.title;
    if (t === false || t === '') return null;
    if (typeof t === 'string') return t;
    return own || null;
}

/** Serialize a whole entity to indexable SSR HTML (SEO cares about words + links,
 *  not interactivity — forms/etc. are rendered client-side on mount). */
function entityToHtml(kind: string, data: Rec | null, options?: Record<string, unknown>,): string {
    if (!data) return '';
    const g = (k: string,): string => escapeHtml(String(data[k] ?? '',),);
    switch (kind) {
        case 'post':
            return `<a class="ssr-entity ssr-entity--post" href="/posts/${g('slug',)}"><h3>${g('title',)}</h3>`
                + (data.excerpt ? `<p>${g('excerpt',)}</p>` : '') + '</a>';
        case 'event':
            // Emits the indexable facts: title, when, where.
            return `<a class="ssr-entity ssr-entity--event" href="/events/${g('slug',)}">`
                + `<h3>${g('title',)}</h3>`
                + (g('startsAt',) ? `<p class="ssr-entity__when">${g('startsAt',)}</p>` : '')
                + (g('location',) ? `<p class="ssr-entity__where">${g('location',)}</p>` : '')
                + `</a>`;
        case 'campaign':
        case 'campaignLink':
            return `<a class="ssr-entity ssr-entity--campaign" href="/campaigns/${g('slug',)}"><h3>${g('title',)}</h3>`
                + (data.shortDescription ? `<p>${g('shortDescription',)}</p>` : '') + '</a>';
        case 'form': {
            const title = optionTitle(String(data.title ?? '',), options,);
            return '<div class="ssr-entity ssr-entity--form">'
                + (title ? `<h3>${escapeHtml(title,)}</h3>` : '')
                + (data.description ? `<p>${g('description',)}</p>` : '') + '</div>';
        }
        case 'page':
            return `<a class="ssr-entity ssr-entity--page" href="/${g('slug',)}">${g('title',)}</a>`;
        case 'media': {
            const url = g('url',);
            return String(data.mimeType ?? '',).startsWith('video',)
                ? `<video class="ssr-entity ssr-entity--media" src="${url}" controls></video>`
                : `<img class="ssr-entity ssr-entity--media" src="${url}" alt="${g('alt',)}" />`;
        }
        case 'user':
            return escapeHtml(String((data.displayName ?? data.name) ?? '',),);
        default: {
            // Generic entity (custom type, no bespoke serializer): emit a title
            // + a short indexable field dump so crawlers see real words.
            const title = g('title',) || g('name',) || g('slug',);
            const body = Object.entries(data,)
                .filter(([k, v,],) => typeof v === 'string' && v && !['id', 'slug', 'title', 'name',].includes(k,))
                .slice(0, 3,)
                .map(([, v,],) => `<p>${escapeHtml(String(v,),)}</p>`)
                .join('',);
            return title
                ? `<div class="ssr-entity ssr-entity--${escapeHtml(kind,)}"><h3>${title}</h3>${body}</div>`
                : '';
        }
    }
}

function buildSsrRuntime(entities: Record<string, Rec | null>,): TemplateRuntime {
    const s = (v: unknown,): string => (v == null ? '' : String(v,));

    const context: Record<string, unknown> = {};
    for (const [name, data,] of Object.entries(entities,)) {
        if (data) context[name] = entityRef(name, data, String(data.id ?? data.slug ?? '',),);
    }

    const resolveExtra = async (name: string, args: unknown[], memo: AsyncMemo,): Promise<unknown> => {
        switch (name) {
            case 'user':
                return entityRef('user', null,);
            case 'posts':
            case 'campaigns':
            case 'forms': {
                const limit = typeof args[0] === 'number' ? (args[0] as number) : 20;
                const { kind, items, } = await memo(`${name}:${limit}`, () => fetchCollection(name, limit,),);
                return items.map((it,) => entityRef(kind, it, s(it.id ?? it.slug,),));
            }
            case 'postCount':
                return (await memo('postCount', () => fetchCollection('posts', 1,),)).total;
            case 'campaignCount':
                return (await memo('campaignCount', () => fetchCollection('campaigns', 200,),)).total;
            case 'formCount':
                return (await memo('formCount', () => fetchCollection('forms', 200,),)).total;
            default: {
                // Generic entity fallback for any registered type.
                await entityManager.ready();
                const plural = entityManager.all().find((x,) => x.pluralVar === name || `${x.key}s` === name);
                if (plural) {
                    const limit = typeof args[0] === 'number' ? (args[0] as number) : 20;
                    const { kind, items, } = await memo(`${name}:${limit}`, () => fetchCollection(name, limit,),);
                    return items.map((it,) => entityRef(kind, it, s(it.id ?? it.slug,),));
                }
                if (entityManager.getType(name,)) {
                    const ref = s(args[0],).trim();
                    if (!ref) return entityRef(name, null,);
                    const data = await memo(`${name}:${ref}`, () => fetchEntity(name, ref, SSR_SINGLE_KINDS,),);
                    return entityRef(name, data, ref,);
                }
                return undefined;
            }
        }
    };

    return buildBackendRuntime({ context, singleKinds: SSR_SINGLE_KINDS, resolveExtra, },);
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
    if (!content || !hasTemplateSyntax(content,)) return content ?? '';
    try {
        const rt = buildSsrRuntime(entities,);
        return await renderTemplateToString(content, rt, (kind, data, options,) => entityToHtml(kind, data as Rec | null, options,),);
    } catch (e) {
        logger.warn('SSR template resolution failed', { error: (e as Error).message, },);
        return content;
    }
}
