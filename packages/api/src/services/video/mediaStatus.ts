/**
 * Set a video's `media.status` from the encode pipeline / worker. Public
 * gallery reads require `m.status = 'ready'`, so a status CHANGE clears the
 * gallery caches too — otherwise a just-encoded video stayed hidden from the
 * anonymous gallery list and collection covers until their 60 s TTL (C8).
 */
import type { MediaStatus, } from '@sitesurge/types';
import * as wrepo from '../../repositories/videoWorker.repo';
import { invalidateGalleryCache, } from '../cache';

export async function setMediaStatus(mediaId: string, status: MediaStatus,): Promise<void> {
    if (await wrepo.setMediaStatus(mediaId, status,)) await invalidateGalleryCache();
}
