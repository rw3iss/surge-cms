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
    DISCUSSION_LIST_KIND,
    type DiscussionItem,
    EVENT_KIND,
    EVENT_LIST_KIND,
    eventDisplayFrom,
    type EventRecord,
    FORUM_THREAD_KIND,
    GALLERY_ITEM_KIND,
    GALLERY_LIST_KIND,
    type GalleryItem,
    entityRef,
    galleryDisplayFrom,
    hasTemplateSyntax,
    itemRadiusCss,
    renderTemplateToString,
    type TemplateRuntime,
} from '@sitesurge/types';
import { logger, } from '../../utils/logger';
import { escapeHtml, } from './blocks/_util';
import { config, } from '../../config';
import { discussionListHtml, forumThreadHtml, } from '../discussions/templateFunctions';
import { galleryEmailHtml, } from '../gallery/render';
import { eventCardsEmailHtml, } from '../events/render';
import { get as settingsGet, } from '../settings';

/** Site origin for absolute links in email (`https://site`), no trailing slash. */
/** Settings → Appearance → Border Radius as CSS (undefined when unset / unreadable). */
async function siteBorderRadius(): Promise<string | undefined> {
    const a = await settingsGet<{ borderRadius?: string; }>('site_appearance',).catch(() => null,);
    return itemRadiusCss(a?.borderRadius,);
}

const siteBase = (): string => String(config.frontendUrl ?? '',).replace(/\/+$/, '',);
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
function entityToMailHtml(kind: string, data: Rec | null, options?: Record<string, unknown>, siteRadius?: string,): string {
    if (!data) return '';
    const g = (k: string,): string => escapeHtml(String(data[k] ?? '',),);
    switch (kind) {
        case 'post':
            return `<strong>${g('title',)}</strong>` + (data.excerpt ? ` — ${g('excerpt',)}` : '');
        case 'campaignStatus': {
            if (data.showRaisedAmount === false) return '';
            const raised = (Number(data.currentAmountCents ?? 0,) / 100).toFixed(2,);
            const goal = Number(data.goalAmountCents ?? 0,);
            return `<strong>$${raised} raised</strong>` + (goal ? ` of $${(goal / 100).toFixed(2,)} goal` : '');
        }
        case 'campaignForm':
            // No form in an inbox — link to the campaign page instead.
            return `<a href="/campaigns/${g('slug',)}">Donate to ${g('title',)}</a>`;
        case 'campaign':
        case 'campaignLink':
            return `<strong>${g('title',)}</strong>` + (data.shortDescription ? ` — ${g('shortDescription',)}` : '');
        case 'form':
            return `<strong>${g('title',)}</strong>`;
        // Discovery lists / one forum thread — absolute links (an inbox has no origin).
        case DISCUSSION_LIST_KIND:
            return discussionListHtml(data as unknown as DiscussionItem[], siteBase(),);
        case FORUM_THREAD_KIND:
            return forumThreadHtml(data, siteBase(),);
        // `{{gallery(...)}}` — an email-safe table grid of PUBLIC media
        // (the runtime resolves with the `email` audience).
        case GALLERY_LIST_KIND:
        case GALLERY_ITEM_KIND: {
            const items = kind === GALLERY_ITEM_KIND ? [data as unknown as GalleryItem,] : (data as unknown as GalleryItem[]);
            const d = galleryDisplayFrom(options ?? {},);
            const desktop = { ...d.desktop, };
            // One item stands alone; a list defaults to 3 across (the block default of 4 is cramped in a 600px inbox).
            if (kind === GALLERY_ITEM_KIND) desktop.layout = 'column';
            else if (options?.columns == null) desktop.columns = 3;
            return galleryEmailHtml(items, siteBase(), { ...d, desktop, }, { siteRadius, },);
        }
        // `{{event('x')}}` / `{{events(...)}}` — email-safe event cards (public
        // events only: the runtime reads as the anonymous visitor).
        case EVENT_KIND:
        case EVENT_LIST_KIND: {
            const records = (kind === EVENT_KIND ? [data,] : data) as unknown as EventRecord[];
            const d = eventDisplayFrom(options ?? {},);
            return eventCardsEmailHtml(records, d, { radius: siteRadius, },);
        }
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

    return buildBackendRuntime({ context, singleKinds: MAIL_SINGLE_KINDS, resolveExtra, galleryAudience: 'email', },);
}

/**
 * Resolve `{{ … }}` in a mail string (rendered HTML, subject, or preheader) to
 * a plain string using the full engine + the supplied per-recipient variable
 * context. Fast-paths strings with no template syntax. Never throws.
 *
 * `opts.html` = the string is an HTML BODY: interpolated values are then
 * HTML-escaped unless they come from a trusted rich field (evaluator.ts), so a
 * member-written value cannot inject markup into the email. Without it the
 * output is raw — right for a subject / preheader, which are plain text.
 * (Raw is the default so a caller that predates escaping keeps its output.)
 */
export async function resolveMailTemplate(
    src: string | null | undefined,
    context: Record<string, unknown>,
    opts: { html?: boolean; } = {},
): Promise<string> {
    if (!src || !hasTemplateSyntax(src,)) return src ?? '';
    try {
        const rt = { ...buildMailRuntime(context,), raw: !opts.html, };
        // `{{gallery()}}` items / event cards default to the site's border radius — read only when one is used.
        const siteRadius = /\b(gallery|events?)\s*\(/.test(src,) ? await siteBorderRadius() : undefined;
        return await renderTemplateToString(src, rt, (kind, data, options,) => entityToMailHtml(kind, data as Rec | null, options, siteRadius,),);
    } catch (e) {
        logger.warn('Mail template resolution failed', { error: (e as Error).message, },);
        return src;
    }
}
