/**
 * Turn a stored original into a video: the `media_videos` row + the first
 * encode job. Called by the direct-upload `complete` step (and usable by any
 * other producer — an import, a future "Videos" page) so there is one way a
 * video enters the pipeline.
 */
import type { PoolClient, } from 'pg';
import type { MediaAccessLevel, } from '@sitesurge/types';
import * as repo from '../../repositories/video.repo';
import { fullPrefix, newEncodeId, teaserPrefix, } from './paths';
import { getVideoSettings, } from './settings';

export interface RegisterVideoInput {
    mediaId: string;
    /** Object key of the original (normally `incoming/<sid>/<name>`). */
    sourceKey: string;
    sourceSize: number;
    accessLevel: MediaAccessLevel;
    keepOriginal?: boolean;
    teaser?: boolean;
    teaserStartSeconds?: number;
    teaserSeconds?: number;
    createdBy?: string | null;
    /**
     * Live recordings: copy the source into a seekable MP4 first (H.264 kept,
     * audio → AAC) and serve it as the replay until HLS is ready. Also jumps
     * the queue — a just-ended show is what viewers are waiting for.
     */
    quickReplay?: boolean;
}

/** Inside the caller's transaction when `client` is given. */
export async function registerVideo(input: RegisterVideoInput, client?: PoolClient,): Promise<repo.VideoRow> {
    const s = await getVideoSettings();
    const encodeId = newEncodeId();
    const teaserOn = input.teaser ?? s.teaserEnabled;
    const video = await repo.insertVideo({
        mediaId: input.mediaId,
        encodeId,
        storagePrefix: fullPrefix(input.mediaId, encodeId,),
        teaserPrefix: teaserOn ? teaserPrefix(input.mediaId, encodeId,) : null,
        sourceKey: input.sourceKey,
        sourceSize: input.sourceSize,
        keepOriginal: input.keepOriginal ?? s.keepOriginal,
        // Decided by the worker at encode time from media.access_level.
        encrypted: false,
        keyVersion: null,
        ivHex: null,
        teaserEnabled: teaserOn,
        teaserStartMs: Math.max(0, Math.round((input.teaserStartSeconds ?? s.teaserStartSeconds) * 1000,),),
        teaserDurationMs: Math.max(1000, Math.round((input.teaserSeconds ?? s.teaserSeconds) * 1000,),),
        quickReplay: input.quickReplay === true,
    }, client,);
    await repo.enqueueJob(input.mediaId, {
        kind: 'encode', createdBy: input.createdBy ?? null, priority: input.quickReplay ? 10 : 100,
    }, client,);
    return video;
}

/** Is this MIME type something the encoder should take? */
export const isVideoMime = (mime: string,): boolean => /^video\//i.test(mime,);
