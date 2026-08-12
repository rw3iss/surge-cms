/**
 * Shared backend runtime plumbing for the `{{ … }}` template engine.
 *
 * The SSR (`services/ssr/templateRuntime.ts`) and mail
 * (`services/mail/templateRuntime.ts`) runtimes both need: a single-flight
 * async memo, a UUID-vs-slug dual entity lookup with a generic-entity
 * fallback, an entity collection fetch, and the shared value-function +
 * single-entity + `campaignLink` resolution core. Those live here; each
 * caller supplies its own whole-entity serializer, its explicit-kind
 * whitelist, and a `resolveExtra` hook for surface-specific names
 * (SSR: collections/counts/`user`/generic-plural; mail: generic-single).
 */
import {
    entityRef,
    resolveValueFunction,
    type TemplateRuntime,
    UNRESOLVED,
} from '@sitesurge/types';
import { logger, } from '../../utils/logger';
import { UUID_RE, } from '../../utils/uuid';
import * as campaignsSvc from '../campaigns';
import * as formsSvc from '../forms';
import * as mediaSvc from '../media';
import * as pagesSvc from '../pages';
import * as postsSvc from '../posts';
import * as entitiesSvc from '../entities';
import * as entityManager from '../../entities/entityManager';

export type Rec = Record<string, unknown>;

/** A single-flight promise memo keyed by string. */
export type AsyncMemo = <T,>(key: string, fn: () => Promise<T>,) => Promise<T>;

/** Build a per-render single-flight promise cache (dedupes identical lookups). */
export function createAsyncMemo(): AsyncMemo {
    const cache = new Map<string, Promise<unknown>>();
    return <T,>(key: string, fn: () => Promise<T>,): Promise<T> => {
        let p = cache.get(key,) as Promise<T> | undefined;
        if (!p) {
            p = fn();
            cache.set(key, p,);
        }
        return p;
    };
}

/**
 * Single-entity lookup by id (UUID) or slug. Kinds present in `explicit`
 * use their bespoke service dual-lookup (post/campaign/form/page/media);
 * everything else resolves through the generic entity service (custom
 * types + core like `user`). Never throws — returns null on miss.
 */
export async function fetchEntity(
    kind: string,
    ref: string,
    explicit: ReadonlySet<string>,
): Promise<Rec | null> {
    const byId = UUID_RE.test(ref,);
    try {
        if (explicit.has(kind,)) {
            switch (kind) {
                case 'post':
                    return ((byId ? await postsSvc.getById(ref,) : await postsSvc.getBySlug(ref,)) as Rec | null)
                        ?? ((byId ? await postsSvc.getBySlug(ref,) : await postsSvc.getById(ref,)) as Rec | null);
                case 'campaign':
                    return ((byId ? await campaignsSvc.getById(ref,) : await campaignsSvc.getBySlug(ref,)) as Rec | null)
                        ?? ((byId ? await campaignsSvc.getBySlug(ref,) : await campaignsSvc.getById(ref,)) as Rec | null);
                case 'form':
                    return ((byId ? await formsSvc.getById(ref,) : await formsSvc.getBySlug(ref,)) as Rec | null)
                        ?? ((byId ? await formsSvc.getBySlug(ref,) : await formsSvc.getById(ref,)) as Rec | null);
                case 'page':
                    return ((byId ? await pagesSvc.getById(ref,) : await pagesSvc.getBySlug(ref,)) as Rec | null)
                        ?? ((byId ? await pagesSvc.getBySlug(ref,) : await pagesSvc.getById(ref,)) as Rec | null);
                case 'media':
                    return byId ? ((await mediaSvc.getById(ref,)) as unknown as Rec) : null;
            }
        }
        // Generic fallback: any registered entity type (custom OR core like
        // `user`) resolves through the generic entity service.
        return (await entitiesSvc.get(kind, ref, { admin: false, },).catch(() => null,)) as Rec | null;
    } catch {
        return null;
    }
}

/** Collection lookup for a plural name (`posts`/`campaigns`/`forms` or any
 *  registered type's plural var). Never throws. */
export async function fetchCollection(
    name: string,
    limit: number,
): Promise<{ kind: string; items: Rec[]; total: number }> {
    try {
        switch (name) {
            case 'posts': {
                const r = await postsSvc.listPublic({}, { limit, },) as { data?: unknown[]; meta?: { total?: number }; };
                const items = (r.data ?? []) as Rec[];
                return { kind: 'post', items, total: r.meta?.total ?? items.length, };
            }
            case 'campaigns': {
                const items = (await campaignsSvc.listPublic({ limit, } as never,)) as unknown as Rec[];
                return { kind: 'campaign', items, total: items.length, };
            }
            case 'forms': {
                const items = (await formsSvc.listPublished()) as unknown as Rec[];
                return { kind: 'form', items: items.slice(0, limit,), total: items.length, };
            }
            default: {
                // Generic fallback: match a registered type by its plural var.
                await entityManager.ready();
                const t = entityManager.all().find((x,) => x.pluralVar === name || `${x.key}s` === name);
                if (!t) return { kind: '', items: [], total: 0, };
                const r = await entitiesSvc.list(t.key, { limit, }, { admin: false, },);
                return { kind: t.key, items: r.items as unknown as Rec[], total: r.total, };
            }
        }
    } catch {
        return { kind: '', items: [], total: 0, };
    }
}

export interface BackendRuntimeOptions {
    /** The per-render variable bag exposed as the runtime `context`. */
    context: Rec;
    /** Kinds resolved as single entities via the bespoke `fetchEntity`
     *  dual-lookup (SSR: post/campaign/form/page/media; mail:
     *  post/campaign/form). Also passed to `fetchEntity` as its explicit set. */
    singleKinds: ReadonlySet<string>;
    /** Surface-specific resolution for names the shared core doesn't handle
     *  (SSR collections/counts/`user`/generic; mail generic-single). Return
     *  `undefined` for an unresolved name. */
    resolveExtra?: (name: string, args: unknown[], memo: AsyncMemo,) => Promise<unknown>;
}

/**
 * Build the shared `TemplateRuntime`. Handles the value-function fallthrough,
 * bespoke single-entity kinds, and `campaignLink`; delegates everything else
 * to `resolveExtra`.
 */
export function buildBackendRuntime(opts: BackendRuntimeOptions,): TemplateRuntime {
    const memo = createAsyncMemo();
    const s = (v: unknown,): string => (v == null ? '' : String(v,));

    const resolve = async (name: string, args: unknown[],): Promise<unknown> => {
        // Shared value/utility functions (upper, formatDate, formatCurrency,
        // default, now, …).
        const vf = resolveValueFunction(name, args,);
        if (vf !== UNRESOLVED) return vf;

        if (opts.singleKinds.has(name,)) {
            const ref = s(args[0],).trim();
            if (!ref) return entityRef(name, null,);
            const data = await memo(`${name}:${ref}`, () => fetchEntity(name, ref, opts.singleKinds,),);
            return entityRef(name, data, ref,);
        }

        if (name === 'campaignLink') {
            const ref = s(args[0],).trim();
            if (!ref) return entityRef('campaignLink', null,);
            const data = await memo(`campaign:${ref}`, () => fetchEntity('campaign', ref, opts.singleKinds,),);
            return entityRef('campaignLink', data, ref,);
        }

        return opts.resolveExtra ? await opts.resolveExtra(name, args, memo,) : undefined;
    };

    return { context: opts.context, resolve, warn: (m,) => logger.debug?.(m,), };
}
