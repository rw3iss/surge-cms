/**
 * Content-block templates: business logic over `contentBlockTemplates.repo`.
 * Thin wrappers that keep the per-entity-type cache fresh on every mutation.
 * Modeled on the mail-template service pair.
 */
import type { ContentBlockTemplate, ContentBlockTemplateBlock, } from '@sitesurge/types';
import * as repo from '../repositories/contentBlockTemplates.repo';
import { cache, CACHE_KEYS, } from './cache';

async function invalidate(entityTypeKey: string | null | undefined,): Promise<void> {
    if (entityTypeKey) await cache.invalidateContentBlockTemplatesCache(entityTypeKey,);
}

export async function listByType(entityTypeKey: string,): Promise<ContentBlockTemplate[]> {
    const key = CACHE_KEYS.contentBlockTemplatesByType(entityTypeKey,);
    const cached = await cache.get<ContentBlockTemplate[]>(key,);
    if (cached) return cached;
    const templates = await repo.listByType(entityTypeKey,);
    await cache.set(key, templates,);
    return templates;
}

export async function findById(id: string,): Promise<ContentBlockTemplate | null> {
    return repo.findById(id,);
}

export async function create(input: repo.CreateInput,): Promise<ContentBlockTemplate> {
    const template = await repo.create(input,);
    await invalidate(template.entityTypeKey,);
    return template;
}

export async function update(id: string, patch: Partial<repo.CreateInput>,): Promise<ContentBlockTemplate | null> {
    const template = await repo.update(id, patch,);
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

export async function replaceBlocks(templateId: string, blocks: repo.SaveBlockInput[],): Promise<void> {
    await repo.replaceBlocks(templateId, blocks,);
    const template = await repo.findById(templateId,);
    if (template) await invalidate(template.entityTypeKey,);
}
