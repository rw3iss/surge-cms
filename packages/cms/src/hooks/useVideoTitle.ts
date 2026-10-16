/**
 * The title a video block shows with "Show title" on — the SAME order the
 * email renderer uses (`mail/blocks/video.ts`): a library video's media title,
 * else the block's own `title` (YouTube / Vimeo / URL videos).
 *
 * Reads `cms.media.playback(id)` — the call `MediaVideo` already makes, so the
 * client cache answers it — only while the switch is on.
 */
import { createResource, type Accessor, } from 'solid-js';
import { cms, } from '../services/cmsClient';

export function useVideoTitle(opts: {
    enabled: Accessor<boolean>;
    mediaId: Accessor<string | undefined>;
    title: Accessor<string | undefined>;
},): Accessor<string> {
    const [mediaTitle,] = createResource(
        () => (opts.enabled() && opts.mediaId()) || null,
        (id,) => cms.media.playback(id,).then((p,) => p.title ?? '',).catch(() => '',),
    );
    return () => {
        if (!opts.enabled()) return '';
        const fromMedia = opts.mediaId() ? (mediaTitle.latest ?? '').trim() : '';
        return fromMedia || (opts.title() ?? '').trim();
    };
}
