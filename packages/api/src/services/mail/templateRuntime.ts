/**
 * Full `{{ … }}` engine for the mail pipeline.
 *
 * Mail historically used a weaker regex substituter (`services/mail/variables.ts`)
 * that only understood flat dotted paths — no functions, no `{{if}}`/`{{for}}`,
 * no entity refs. This wires the SAME shared engine the content/SSR side uses
 * (`@sitesurge/types` template) into the mail render pass, so every text field
 * of every block (already emitted verbatim into the rendered HTML), plus the
 * subject and preheader, resolve with the full grammar and the complete
 * variable set.
 *
 * The runtime `context` is the per-recipient variable bag (user/list/site/
 * unsubscribe_url/verification_url/campaign/…). `resolve()` layers on the shared
 * value functions (upper, formatDate, formatCurrency, default, now, …) and
 * single-entity lookups (`campaign('id')`, `post('slug')`, `form('id')`) so
 * `{{campaign('id').title}}` works. Whole-entity refs flatten to a small inline
 * fragment via `onEntity`.
 *
 * Never throws: a parse or resolver error degrades to the raw source so a send
 * is never lost to a template typo.
 */
import {
    entityRef,
    hasTemplateSyntax,
    renderTemplateToString,
    resolveValueFunction,
    type TemplateRuntime,
    UNRESOLVED,
} from '@sitesurge/types';
import { logger, } from '../../utils/logger';
import * as campaignsSvc from '../campaigns';
import * as formsSvc from '../forms';
import * as postsSvc from '../posts';
import * as entitiesSvc from '../entities';
import { escapeHtml, } from './blocks/_util';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Rec = Record<string, unknown>;

/** Single-entity lookup by id (UUID) or slug. Mirrors the SSR runtime's
 *  entity resolver but scoped to the entity kinds that make sense in an
 *  email (post / campaign / form). Never throws — returns null on miss. */
async function fetchEntity(kind: string, ref: string,): Promise<Rec | null> {
    const byId = UUID_RE.test(ref,);
    try {
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
            default:
                return (await entitiesSvc.get(kind, ref, { admin: false, },).catch(() => null,)) as Rec | null;
        }
    } catch {
        return null;
    }
}

/** Flatten a whole-entity ref (`{{campaign('id')}}` with no property) to a
 *  small inline HTML fragment. Emails aren't interactive, so a title +
 *  short blurb is all we can meaningfully render. */
function entityToMailHtml(kind: string, data: Rec | null,): string {
    if (!data) return '';
    const g = (k: string,): string => escapeHtml(String(data[k] ?? '',),);
    switch (kind) {
        case 'post':
            return `<strong>${g('title',)}</strong>` + (data.excerpt ? ` — ${g('excerpt',)}` : '');
        case 'campaign':
        case 'campaignLink':
            return `<strong>${g('title',)}</strong>` + (data.shortDescription ? ` — ${g('shortDescription',)}` : '');
        case 'form':
            return `<strong>${g('title',)}</strong>`;
        default: {
            const title = g('title',) || g('name',);
            return title ? `<strong>${title}</strong>` : '';
        }
    }
}

function buildMailRuntime(context: Rec,): TemplateRuntime {
    const cache = new Map<string, Promise<unknown>>();
    const memo = <T,>(key: string, fn: () => Promise<T>,): Promise<T> => {
        let p = cache.get(key,) as Promise<T> | undefined;
        if (!p) { p = fn(); cache.set(key, p,); }
        return p;
    };
    const s = (v: unknown,): string => (v == null ? '' : String(v,));

    const resolve = async (name: string, args: unknown[],): Promise<unknown> => {
        // Shared value/utility functions (upper, lower, truncate, formatDate,
        // formatCurrency, formatNumber, default, now, year).
        const vf = resolveValueFunction(name, args,);
        if (vf !== UNRESOLVED) return vf;

        switch (name) {
            case 'post':
            case 'campaign':
            case 'form': {
                const ref = s(args[0],).trim();
                if (!ref) return entityRef(name, null,);
                const data = await memo(`${name}:${ref}`, () => fetchEntity(name, ref,),);
                return entityRef(name, data, ref,);
            }
            case 'campaignLink': {
                const ref = s(args[0],).trim();
                if (!ref) return entityRef('campaignLink', null,);
                const data = await memo(`campaign:${ref}`, () => fetchEntity('campaign', ref,),);
                return entityRef('campaignLink', data, ref,);
            }
            default: {
                // Generic fallback: any registered entity type resolves via the
                // generic service (custom types + core like `user`/`page`).
                const ref = s(args[0],).trim();
                if (!ref) return undefined;
                const data = await memo(`${name}:${ref}`, () => fetchEntity(name, ref,),);
                return entityRef(name, data, ref,);
            }
        }
    };

    return { context, resolve, warn: (m,) => logger.debug?.(m,), };
}

/**
 * Resolve `{{ … }}` in a mail string (rendered HTML, subject, or preheader) to
 * a plain string using the full engine + the supplied per-recipient variable
 * context. Fast-paths strings with no template syntax. Never throws.
 */
export async function resolveMailTemplate(
    src: string | null | undefined,
    context: Record<string, unknown>,
): Promise<string> {
    if (!src || !hasTemplateSyntax(src,)) return src ?? '';
    try {
        const rt = buildMailRuntime(context,);
        return await renderTemplateToString(src, rt, (kind, data,) => entityToMailHtml(kind, data as Rec | null,),);
    } catch (e) {
        logger.warn('Mail template resolution failed', { error: (e as Error).message, },);
        return src;
    }
}
