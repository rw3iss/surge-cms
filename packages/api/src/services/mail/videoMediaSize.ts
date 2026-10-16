/**
 * Give every library Video block its media's pixel size, for email.
 *
 * The mail renderers are synchronous, so a video block knows only its
 * `mediaId`. Without the aspect ratio a capped poster can carry a height but
 * not a matching width — and Outlook, which ignores `max-height`, needs both
 * attributes to keep the picture inside the block. One batched query per render.
 */
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { VIDEO_MEDIA_SIZE_KEY, } from './blocks/_util';

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

    let sizes: Map<string, { width: number; height: number; }>;
    try {
        const r = await query(
            `SELECT id::text AS id, width, height FROM media
              WHERE id::text = ANY($1::text[]) AND width > 0 AND height > 0`,
            [ids,],
        );
        sizes = new Map(
            (r.rows as Array<{ id: string; width: number; height: number; }>)
                .map((row,) => [row.id, { width: Number(row.width,), height: Number(row.height,), },]),
        );
    } catch (e) {
        // A missing size only costs Outlook its exact width — never the email.
        logger.warn('Mail: video media size lookup failed', { error: (e as Error).message, },);
        return blocks;
    }
    if (sizes.size === 0) return blocks;

    return blocks.map((b,) => {
        const size = b.blockType === 'video' ? sizes.get(String(b.settings?.mediaId ?? '',),) : undefined;
        return size ? { ...b, settings: { ...b.settings, [VIDEO_MEDIA_SIZE_KEY]: size, }, } : b;
    },);
}
