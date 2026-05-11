/**
 * Admin routes for mail templates + the preview endpoint that the
 * editor's iframe hits.
 *
 *   GET    /                       — list
 *   POST   /                       — create
 *   GET    /:id                    — template meta + blocks
 *   PUT    /:id                    — update meta
 *   DELETE /:id                    — remove
 *   PUT    /:id/blocks             — replace block tree
 *   POST   /preview                — render preview HTML
 *   GET    /variables              — variable catalog for the reference UI
 */
import { Router, } from 'express';
import { z, } from 'zod';
import { query, } from '../db';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { NotFoundError, ValidationError, } from '../middleware/error';
import * as templates from '../repositories/mailTemplates.repo';
import * as templateBlocks from '../repositories/mailTemplateBlocks.repo';
import { renderMailHtml, } from '../services/mail/renderer';
import {
    buildSampleContext, describeVariables, substituteVariables,
} from '../services/mail/variables';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import { handleRouteError, sendCreated, sendSuccess, } from '../utils/response';

const router = Router();

const templateSchema = z.object({
    name: z.string().min(1,).max(255,),
    description: z.string().optional(),
    isEnabled: z.boolean().optional(),
    subject: z.string().max(1000,).optional(),
    preheader: z.string().max(255,).optional(),
    fromName: z.string().max(255,).optional(),
    fromEmail: z.string().email().or(z.literal('',),).optional(),
    replyTo: z.string().email().or(z.literal('',),).optional(),
},);

const blockSchema = z.object({
    id: z.string().uuid().optional(),
    parentBlockId: z.string().uuid().nullable().optional(),
    blockType: z.string().min(1,),
    position: z.number().int().min(0,),
    settings: z.record(z.string(), z.unknown(),).optional(),
    style: z.record(z.string(), z.unknown(),).optional(),
},);

router.get('/variables', authenticate(), requireAdmin, (_req, res,) => {
    try { sendSuccess(res, describeVariables(),); } catch (e) { handleRouteError(res, e, 'variables',); }
},);

router.get('/', authenticate(), requireAdmin, async (_req, res,) => {
    try { sendSuccess(res, await templates.list(),); } catch (e) { handleRouteError(res, e, 'list templates',); }
},);

router.post('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const parsed = templateSchema.safeParse(req.body,);
        if (!parsed.success) throw new ValidationError('Invalid input', { issues: parsed.error.issues, },);
        const created = await templates.create({ ...parsed.data, createdBy: req.userId!, },);
        await cache.invalidateMailTemplatesCache();
        await logAudit({
            userId: req.userId!,
            action: 'create',
            entityType: 'mail_template',
            entityId: created.id,
            newValues: { ...created, } as unknown as Record<string, unknown>,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendCreated(res, created,);
    } catch (e) { handleRouteError(res, e, 'create template',); }
},);

router.get('/:id', authenticate(), requireAdmin, async (req, res,) => {
    try {
        const tpl = await templates.findById(req.params.id,);
        if (!tpl) throw new NotFoundError('Template not found',);
        const blocks = await templateBlocks.findByTemplate(req.params.id,);
        sendSuccess(res, { ...tpl, blocks, },);
    } catch (e) { handleRouteError(res, e, 'fetch template',); }
},);

router.put('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const parsed = templateSchema.partial().safeParse(req.body,);
        if (!parsed.success) throw new ValidationError('Invalid input', { issues: parsed.error.issues, },);
        const updated = await templates.update(req.params.id, parsed.data,);
        if (!updated) throw new NotFoundError('Template not found',);
        await cache.invalidateMailTemplatesCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'mail_template',
            entityId: req.params.id,
            newValues: parsed.data as Record<string, unknown>,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, updated,);
    } catch (e) { handleRouteError(res, e, 'update template',); }
},);

router.delete('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await templates.remove(req.params.id,);
        await cache.invalidateMailTemplatesCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'delete',
            entityType: 'mail_template',
            entityId: req.params.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, { ok: true, },);
    } catch (e) { handleRouteError(res, e, 'delete template',); }
},);

router.put('/:id/blocks', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const arr = Array.isArray(req.body?.blocks,) ? req.body.blocks : [];
        const parsed = z.array(blockSchema,).safeParse(arr,);
        if (!parsed.success) throw new ValidationError('Invalid blocks', { issues: parsed.error.issues, },);
        await templateBlocks.replaceAll(req.params.id, parsed.data,);
        await cache.invalidateMailTemplatesCache(req.params.id,);
        sendSuccess(res, { ok: true, count: parsed.data.length, },);
    } catch (e) { handleRouteError(res, e, 'save template blocks',); }
},);

// ─── Preview ────────────────────────────────────────────────────────

const previewSchema = z.object({
    blocks: z.array(blockSchema,).optional(),
    subject: z.string().max(1000,).optional(),
    preheader: z.string().max(255,).optional(),
    variables: z.record(z.string(), z.string(),).optional(),
},);

router.post('/preview', authenticate(), requireAdmin, async (req, res,) => {
    try {
        const parsed = previewSchema.safeParse(req.body,);
        if (!parsed.success) throw new ValidationError('Invalid preview input', { issues: parsed.error.issues, },);

        // Read site palette + name/url from site_settings.
        const settingsRes = await query<{ key: string; value: unknown; }>(
            `SELECT key, value FROM site_settings`,
        );
        const settingsMap: Record<string, unknown> = {};
        for (const row of settingsRes.rows) settingsMap[row.key] = row.value;

        const palette: Record<string, string> = {};
        const rawSwatches = settingsMap.site_colors;
        if (Array.isArray(rawSwatches,)) {
            for (const s of rawSwatches as Array<{ id?: unknown; hex?: unknown; }>) {
                if (typeof s.id === 'string' && typeof s.hex === 'string') palette[s.id] = s.hex;
            }
        }

        // The preview endpoint accepts in-progress blocks that may not
        // have IDs yet — synthesize a placeholder so the renderer's
        // tree builder doesn't choke on `undefined` keys.
        const rawBlocks = parsed.data.blocks ?? [];
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
            subject: parsed.data.subject ?? '',
            preheader: parsed.data.preheader,
            siteName: (settingsMap.site_name as string) ?? 'Site',
            siteUrl: (settingsMap.site_url as string) ?? '',
            palette,
        },);

        // Merge sample defaults from the catalog with operator-supplied
        // overrides from the preview form's variable inputs.
        const ctx = buildSampleContext(parsed.data.variables ?? {},);

        sendSuccess(res, {
            html: substituteVariables(result.html, ctx,),
            subject: substituteVariables(result.subject, ctx,),
            preheader: result.preheader ? substituteVariables(result.preheader, ctx,) : undefined,
            detectedVariables: result.detectedVariables,
        },);
    } catch (e) { handleRouteError(res, e, 'preview',); }
},);

export default router;
