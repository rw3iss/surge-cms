/**
 * Mail templates service.
 *
 * Owns all business logic for the mail template manager: CRUD over the
 * `mail_templates` table, the transactional block-tree replace, the
 * variable catalog, and preview rendering. The route layer in
 * `routes/mailTemplates.ts` thinly wraps this module so logic lives in
 * exactly one place; the render orchestration delegates to
 * `services/mail/*`.
 */
import type { MailTemplate, } from '@sitesurge/types';
import { NotFoundError, } from '../core/errors';
import * as templates from '../repositories/mailTemplates.repo';
import * as templateBlocks from '../repositories/mailTemplateBlocks.repo';
import { renderMailHtml, } from './mail/renderer';
import { loadMailRenderContext, } from './mail/siteContext';
import { buildSampleContext, describeVariables, substituteVariables, } from './mail/variables';
import { logAudit, } from './audit';
import { cache, } from './cache';
import type { AuditContext, } from './types';
import { uuidOrNull, } from '../utils/uuid';

export interface TemplateInput {
    name: string;
    description?: string;
    isEnabled?: boolean;
    subject?: string;
    preheader?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
}

export interface TemplateBlockInput {
    id?: string;
    parentBlockId?: string | null;
    blockType: string;
    position: number;
    settings?: Record<string, unknown>;
    style?: Record<string, unknown>;
}

export interface PreviewInput {
    blocks?: TemplateBlockInput[];
    subject?: string;
    preheader?: string;
    variables?: Record<string, string>;
}

/** Variable catalog for the reference UI. */
export function variables() {
    return describeVariables();
}

export function list(): Promise<MailTemplate[]> {
    return templates.list();
}

/** Template meta + its block tree. */
export async function getById(id: string,) {
    const tpl = await templates.findById(id,);
    if (!tpl) throw new NotFoundError('Template',);
    const blocks = await templateBlocks.findByTemplate(id,);
    return { ...tpl, blocks, };
}

export async function create(input: TemplateInput, ctx: AuditContext,): Promise<MailTemplate> {
    // created_by is a UUID FK — synthetic actors (API keys / system)
    // become NULL rather than violating the column type.
    const created = await templates.create({ ...input, createdBy: uuidOrNull(ctx.userId,), },);
    await cache.invalidateMailTemplatesCache();
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'mail_template',
        entityId: created.id,
        newValues: { ...created, } as unknown as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return created;
}

export async function update(id: string, patch: Partial<TemplateInput>, ctx: AuditContext,): Promise<MailTemplate> {
    const updated = await templates.update(id, patch,);
    if (!updated) throw new NotFoundError('Template',);
    await cache.invalidateMailTemplatesCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'mail_template',
        entityId: id,
        newValues: patch as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return updated;
}

export async function remove(id: string, ctx: AuditContext,): Promise<void> {
    await templates.remove(id,);
    await cache.invalidateMailTemplatesCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'mail_template',
        entityId: id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

/** Transactional replace of a template's whole block tree. */
export async function replaceBlocks(id: string, blocks: TemplateBlockInput[],): Promise<{ count: number; }> {
    await templateBlocks.replaceAll(id, blocks,);
    await cache.invalidateMailTemplatesCache(id,);
    return { count: blocks.length, };
}

/** Render an in-progress block set to preview HTML with variables resolved. */
export async function preview(input: PreviewInput,) {
    const renderCtx = await loadMailRenderContext();

    // The preview endpoint accepts in-progress blocks that may not have
    // IDs yet — synthesize a placeholder so the renderer's tree builder
    // doesn't choke on `undefined` keys.
    const rawBlocks = input.blocks ?? [];
    const blocksForRender = rawBlocks.map((b, i,) => ({
        id: b.id ?? `preview-${i}`,
        parentBlockId: b.parentBlockId ?? null,
        blockType: b.blockType,
        position: b.position,
        settings: (b.settings ?? {}) as Record<string, unknown>,
        style: (b.style ?? {}) as Record<string, unknown>,
    }));

    // Resolve `style = { id: <templateId> }` refs to their inlined
    // property bags so the renderer sees a plain style record.
    const resolved = await templateBlocks.populateBlockStyles(blocksForRender,);

    const result = renderMailHtml({
        blocks: resolved,
        subject: input.subject ?? '',
        preheader: input.preheader,
        ...renderCtx,
    },);

    // Merge sample defaults from the catalog with operator-supplied
    // overrides from the preview form's variable inputs.
    const ctx = buildSampleContext(input.variables ?? {},);

    return {
        html: substituteVariables(result.html, ctx,),
        subject: substituteVariables(result.subject, ctx,),
        preheader: result.preheader ? substituteVariables(result.preheader, ctx,) : undefined,
        detectedVariables: result.detectedVariables,
    };
}
