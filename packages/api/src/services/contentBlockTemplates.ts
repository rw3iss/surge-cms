/**
 * Content-block templates: business logic over `contentBlockTemplates.repo`.
 * Thin wrappers that keep the per-entity-type cache fresh on every mutation.
 * Modeled on the mail-template service pair.
 */
import type { ContentBlockTemplate, ContentBlockTemplateBlock, TemplateUsage, } from '@sitesurge/types';
import { query, } from '../db';
import { normalizeTemplateSlots, } from '@sitesurge/types';
import * as entityManager from '../entities/entityManager';
import * as repo from '../repositories/contentBlockTemplates.repo';
import { ValidationError, } from '../middleware/error';
import { cache, CACHE_KEYS, } from './cache';

/**
 * Drop the cached list a template belongs to.
 *
 * A null/undefined key is NOT a no-op: it means the template is global, and the
 * global list needs clearing just as much. Treating null as "nothing to do"
 * would leave a stale component list after every create/update/delete.
 */
async function invalidate(entityTypeKey: string | null | undefined,): Promise<void> {
    if (entityTypeKey) await cache.invalidateContentBlockTemplatesCache(entityTypeKey,);
    else await cache.invalidateContentBlockTemplatesGlobalCache();
}

export async function listByType(entityTypeKey: string,): Promise<ContentBlockTemplate[]> {
    const key = CACHE_KEYS.contentBlockTemplatesByType(entityTypeKey,);
    const cached = await cache.get<ContentBlockTemplate[]>(key,);
    if (cached) return cached;
    const templates = await repo.listByType(entityTypeKey,);
    await cache.set(key, templates,);
    return templates;
}

/** Entity-less templates — the reusable components. */
export async function listGlobal(): Promise<ContentBlockTemplate[]> {
    const key = CACHE_KEYS.contentBlockTemplatesGlobal;
    const cached = await cache.get<ContentBlockTemplate[]>(key,);
    if (cached) return cached;
    const templates = await repo.listGlobal();
    await cache.set(key, templates,);
    return templates;
}

export async function findById(id: string,): Promise<ContentBlockTemplate | null> {
    return repo.findById(id,);
}

/**
 * Validate a template's `slots` (unique ids, id format, registered entity
 * type, ≤ MAX_TEMPLATE_SLOTS) and return the cleaned list. Throws a 400.
 */
export function validateSlots(input: unknown,): NonNullable<repo.CreateInput['slots']> {
    const { slots, errors, } = normalizeTemplateSlots(input, key => !!entityManager.getType(key,),);
    if (errors.length) throw new ValidationError(`Invalid template slots: ${errors.join('; ',)}`,);
    return slots;
}

function withSlots<T extends Partial<repo.CreateInput>,>(input: T,): T {
    return input.slots === undefined ? input : { ...input, slots: validateSlots(input.slots,), };
}

export async function create(input: repo.CreateInput,): Promise<ContentBlockTemplate> {
    const template = await repo.create(withSlots(input,),);
    await invalidate(template.entityTypeKey,);
    return template;
}

export async function update(id: string, patch: Partial<repo.CreateInput>,): Promise<ContentBlockTemplate | null> {
    const template = await repo.update(id, withSlots(patch,),);
    if (template) await invalidate(template.entityTypeKey,);
    return template;
}

export async function remove(id: string,): Promise<void> {
    const template = await repo.findById(id,);
    await repo.remove(id,);
    if (template) await invalidate(template.entityTypeKey,);
}

export async function findBlocks(templateId: string,): Promise<ContentBlockTemplateBlock[]> {
    return repo.findBlocks(templateId,);
}

export async function findBlocksResolved(templateId: string,): Promise<ContentBlockTemplateBlock[]> {
    return repo.findBlocksResolved(templateId,);
}

/** Create with blocks (`id` null) or update meta + blocks — one transaction. */
export async function saveWithBlocks(
    id: string | null,
    input: Partial<repo.CreateInput>,
    blocks: repo.SaveBlockInput[],
): Promise<ContentBlockTemplate | null> {
    const template = await repo.saveWithBlocks(id, withSlots(input,), blocks,);
    if (template) await invalidate(template.entityTypeKey,);
    return template;
}

export async function replaceBlocks(templateId: string, blocks: repo.SaveBlockInput[],): Promise<void> {
    await repo.replaceBlocks(templateId, blocks,);
    const template = await repo.findById(templateId,);
    if (template) await invalidate(template.entityTypeKey,);
}

/**
 * Where templates / components are used: every page, post, mail template and
 * other template whose blocks reference one of `templateIds` — as a component
 * (`settings.templateId`), an entity block (`settings.entity.templateId`) or a
 * carousel entity item (`settings.items[].entity.templateId`). Matched on the
 * id string inside the settings JSON: ids are UUIDs, so every reference shape
 * is covered without listing them (and a new one cannot be missed).
 *
 * Deleting a referenced template silently empties every one of these, so the
 * admin shows the list and asks for confirmation first.
 */
const USAGE_SOURCES: Array<{ kind: TemplateUsage['kind']; table: string; fk: string; settings: string; owner: string; title: string; }> = [
    { kind: 'page', table: 'blocks', fk: 'page_id', settings: 'settings', owner: 'pages', title: 'title', },
    { kind: 'post', table: 'post_content_blocks', fk: 'post_id', settings: 'data', owner: 'posts', title: 'title', },
    { kind: 'mail_template', table: 'mail_template_blocks', fk: 'template_id', settings: 'settings', owner: 'mail_templates', title: 'name', },
    { kind: 'template', table: 'content_block_template_blocks', fk: 'template_id', settings: 'settings', owner: 'content_block_templates', title: 'name', },
];

export async function usages(templateIds: string[],): Promise<Map<string, TemplateUsage[]>> {
    const out = new Map<string, TemplateUsage[]>();
    const ids = templateIds.filter(Boolean,);
    if (ids.length === 0) return out;
    await Promise.all(USAGE_SOURCES.map(async (src,) => {
        try {
            const r = await query<{ tid: string; owner_id: string; title: string | null; n: number; }>(
                `SELECT m.tid, b.${src.fk}::text AS owner_id, e.${src.title} AS title, COUNT(*)::int AS n
                   FROM ${src.table} b
                   JOIN ${src.owner} e ON e.id = b.${src.fk}
                   JOIN unnest($1::text[]) AS m(tid) ON b.${src.settings}::text LIKE '%' || m.tid || '%'
                  WHERE NOT ($2 AND b.${src.fk}::text = m.tid)
                  GROUP BY m.tid, b.${src.fk}, e.${src.title}`,
                [ids, src.kind === 'template',],
            );
            for (const row of r.rows) {
                const list = out.get(row.tid,) ?? [];
                list.push({ kind: src.kind, id: row.owner_id, title: row.title || '(untitled)', blocks: row.n, },);
                out.set(row.tid, list,);
            }
        } catch {
            // A table missing on this install (feature not enabled) has no usages.
        }
    },),);
    return out;
}

/** Attach `usages` + `usageCount` to each template (staff list views). */
export async function withUsageCounts(templates: ContentBlockTemplate[],): Promise<ContentBlockTemplate[]> {
    const map = await usages(templates.map((t,) => t.id),);
    return templates.map((t,) => {
        const u = map.get(t.id,) ?? [];
        return { ...t, usages: u, usageCount: u.length, };
    },);
}
