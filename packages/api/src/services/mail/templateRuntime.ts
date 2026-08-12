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
 * unsubscribe_url/verification_url/campaign/…). The memo/entity-lookup/
 * resolution core is shared with the SSR runtime via
 * `services/template/backendRuntime.ts`; this file owns only the mail-specific
 * serializer + the generic-single fallback.
 *
 * Never throws: a parse or resolver error degrades to the raw source so a send
 * is never lost to a template typo.
 */
import {
    entityRef,
    hasTemplateSyntax,
    renderTemplateToString,
    type TemplateRuntime,
} from '@sitesurge/types';
import { logger, } from '../../utils/logger';
import { escapeHtml, } from './blocks/_util';
import {
    type AsyncMemo,
    buildBackendRuntime,
    fetchEntity,
    type Rec,
} from '../template/backendRuntime';

/** Kinds resolved via the bespoke service dual-lookup in an email
 *  (post/campaign/form). Any other registered type falls through to the
 *  generic entity service. */
const MAIL_SINGLE_KINDS: ReadonlySet<string> = new Set([
    'post',
    'campaign',
    'form',
]);

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
    const s = (v: unknown,): string => (v == null ? '' : String(v,));

    const resolveExtra = async (name: string, args: unknown[], memo: AsyncMemo,): Promise<unknown> => {
        // Generic fallback: any registered entity type resolves via the
        // generic service (custom types + core like `user`/`page`).
        const ref = s(args[0],).trim();
        if (!ref) return undefined;
        const data = await memo(`${name}:${ref}`, () => fetchEntity(name, ref, MAIL_SINGLE_KINDS,),);
        return entityRef(name, data, ref,);
    };

    return buildBackendRuntime({ context, singleKinds: MAIL_SINGLE_KINDS, resolveExtra, },);
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
