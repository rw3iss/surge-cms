/**
 * Unified transactional email service.
 *
 * Renders a standalone mail (a subject + a mail block tree, NOT tied to a
 * `mail_templates` row) through the SAME renderer + full `{{ }}` engine the
 * template / mailing-list pipeline uses, then sends it via the configured
 * provider. This is the DRY home for every non-mailing-list email the CMS
 * sends to a specific user (email verification today; welcome / donation
 * receipts can migrate here next) so they all share one render + variable
 * path — no bespoke HTML strings drifting per feature.
 */
import type { FlatBlock, } from './renderer';
import { renderMailHtml, } from './renderer';
import { loadMailRenderContext, } from './siteContext';
import { resolveMailTemplate, } from './templateRuntime';
import { populateBlockStyles, } from '../../repositories/mailTemplateBlocks.repo';
import { sendEmail, } from '../email';

export interface StandaloneMailInput {
    subject: string;
    preheader?: string;
    /** Mail block tree (mail_template_blocks wire shape). */
    blocks: FlatBlock[];
}

export interface RenderedMail {
    subject: string;
    html: string;
    preheader?: string;
}

/**
 * Render a standalone block set to `{ subject, html }` with `{{ }}` resolved
 * against `context`. Block-style template refs are inlined; site name / URL /
 * palette come from `site_settings`.
 */
export async function renderStandaloneMail(
    input: StandaloneMailInput,
    context: Record<string, unknown>,
): Promise<RenderedMail> {
    const renderCtx = await loadMailRenderContext();

    // Synthesize ids for any block without one (fresh, unsaved trees) so the
    // renderer's tree builder doesn't choke on undefined keys.
    // Concrete (non-optional) style/settings so populateBlockStyles's
    // `{ style: Record }` constraint is satisfied; DON'T re-widen to FlatBlock[].
    const blocksForRender = input.blocks.map((b, i,) => ({
        id: b.id ?? `mail-${i}`,
        parentBlockId: b.parentBlockId ?? null,
        blockType: b.blockType,
        position: b.position ?? i,
        settings: (b.settings ?? {}) as Record<string, unknown>,
        style: (b.style ?? {}) as Record<string, unknown>,
    }));

    const resolved = await populateBlockStyles(blocksForRender,);
    const result = renderMailHtml({
        blocks: resolved,
        subject: input.subject,
        preheader: input.preheader,
        ...renderCtx,
    },);

    return {
        subject: await resolveMailTemplate(result.subject, context,),
        html: await resolveMailTemplate(result.html, context,),
        preheader: result.preheader ? await resolveMailTemplate(result.preheader, context,) : undefined,
    };
}

export interface SendTemplatedEmailInput extends StandaloneMailInput {
    to: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    context: Record<string, unknown>;
}

/** Render + send a standalone templated email to one recipient. */
export async function sendTemplatedEmail(input: SendTemplatedEmailInput,): Promise<void> {
    const rendered = await renderStandaloneMail(
        { subject: input.subject, preheader: input.preheader, blocks: input.blocks, },
        input.context,
    );
    await sendEmail({
        to: input.to,
        subject: rendered.subject,
        html: rendered.html,
        fromName: input.fromName,
        fromEmail: input.fromEmail,
        replyTo: input.replyTo,
    },);
}
