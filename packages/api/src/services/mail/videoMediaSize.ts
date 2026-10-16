/**
 * Give every library Video block its media's pixel size, for email.
 *
 * The mail renderers are synchronous, so a video block knows only its
 * `mediaId`. Without the aspect ratio a capped poster can carry a height but
 * not a matching width — and Outlook, which ignores `max-height`, needs both
 * attributes to keep the picture inside the block. The media's TITLE rides
 * along too (`VIDEO_MEDIA_TITLE_KEY`) for the block's "Show title" option.
 * One batched query per render.
 */
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { VIDEO_MEDIA_SIZE_KEY, VIDEO_MEDIA_TITLE_KEY, } from './blocks/_util';

interface SizedBlock { blockType: string; settings: Record<string, unknown>; }

export async function attachVideoMediaSize<T extends SizedBlock,>(blocks: T[],): Promise<T[]> {
    const ids = [
        ...new Set(
            blocks
                .filter((b,) => b.blockType === 'video' && typeof b.settings?.mediaId === 'string' && b.settings.mediaId
                    && !b.settings[VIDEO_MEDIA_SIZE_KEY])
                .map((b,) => String(b.settings.mediaId,),),
        ),
    ];
    if (ids.length === 0) return blocks;

    let found: Map<string, { size: { width: number; height: number; } | null; title: string | null; }>;
    try {
        const r = await query(
            `SELECT id::text AS id, width, height, title FROM media WHERE id::text = ANY($1::text[])`,
            [ids,],
        );
        found = new Map(
            (r.rows as Array<{ id: string; width: number | null; height: number | null; title: string | null; }>)
                .map((row,) => [row.id, {
                    size: Number(row.width,) > 0 && Number(row.height,) > 0
                        ? { width: Number(row.width,), height: Number(row.height,), }
                        : null,
                    title: row.title?.trim() || null,
                },]),
        );
    } catch (e) {
        // A missing size only costs Outlook its exact width — never the email.
        logger.warn('Mail: video media lookup failed', { error: (e as Error).message, },);
        return blocks;
    }
    if (found.size === 0) return blocks;

    return blocks.map((b,) => {
        const hit = b.blockType === 'video' ? found.get(String(b.settings?.mediaId ?? '',),) : undefined;
        if (!hit || (!hit.size && !hit.title)) return b;
        return {
            ...b,
            settings: {
                ...b.settings,
                ...(hit.size ? { [VIDEO_MEDIA_SIZE_KEY]: hit.size, } : {}),
                ...(hit.title ? { [VIDEO_MEDIA_TITLE_KEY]: hit.title, } : {}),
            },
        };
    },);
}
