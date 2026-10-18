/**
 * Seed (or restore) the "Event Card" entity template for the `event` type.
 *
 * One `html` block, list mode, one card per record (`listRender: 'each'`) —
 * markup + styles in `src/services/events/eventCardTemplate.ts`. Use it from
 * an entity block / carousel entity item bound to events, or as the starting
 * point for your own card.
 *
 * Idempotent BY NAME: a template named "Event Card" on the `event` type is
 * updated in place (its block tree replaced), otherwise one is created. Safe
 * to re-run; run once on production after a deploy that ships it.
 *
 * Run with:
 *   npm run seed:event-template            (in packages/api)
 *
 * Needs the Events feature enabled (the `event` entity type must exist).
 */
import { closePool, getPool, query, } from '../src/db/client';
import { logger, } from '../src/utils/logger';
import * as templates from '../src/services/contentBlockTemplates';
import { flushAll as flushRevisions, } from '../src/services/revisions';
import {
    EVENT_CARD_TEMPLATE_DESCRIPTION, EVENT_CARD_TEMPLATE_HTML, EVENT_CARD_TEMPLATE_NAME,
} from '../src/services/events/eventCardTemplate';

async function main(): Promise<void> {
    getPool();
    const type = await query<{ key: string; }>(`SELECT key FROM entity_types WHERE key = 'event'`,);
    if (!type.rows.length) {
        logger.error('The `event` entity type does not exist — enable the Events feature (and restart once), then re-run.',);
        process.exitCode = 1;
        return;
    }
    const existing = await query<{ id: string; }>(
        `SELECT id FROM content_block_templates WHERE entity_type_key = 'event' AND name = $1 ORDER BY created_at ASC LIMIT 1`,
        [EVENT_CARD_TEMPLATE_NAME,],
    );
    const id = existing.rows[0]?.id ?? null;
    const saved = await templates.saveWithBlocks(
        id,
        {
            name: EVENT_CARD_TEMPLATE_NAME,
            description: EVENT_CARD_TEMPLATE_DESCRIPTION,
            entityTypeKey: 'event',
            mode: 'list',
            listRender: 'each',
            maxRecords: 12,
        },
        [{ blockType: 'html', position: 0, settings: { content: EVENT_CARD_TEMPLATE_HTML, }, style: {}, },],
    );
    logger.info(`${id ? 'Updated' : 'Created'} template "${EVENT_CARD_TEMPLATE_NAME}" (${saved?.id}).`,);
    // The save schedules a revision snapshot after a quiet period — take it now.
    await flushRevisions();
}

main()
    .catch((err,) => {
        logger.error('Seeding the Event Card template failed', { error: err, },);
        process.exitCode = 1;
    },)
    .finally(async () => {
        await closePool().catch(() => undefined);
        // Redis (cache invalidation) may hold the event loop open.
        setTimeout(() => process.exit(process.exitCode ?? 0,), 200,).unref();
    },);
