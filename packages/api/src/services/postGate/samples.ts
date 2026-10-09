/**
 * Content samples for locked posts, by post TYPE.
 *
 * Each strategy decides what a non-subscriber sees of a post. Today every post
 * is an `article`: the blocks BEFORE the first rich-text block (banner image,
 * intro video…) plus the first `percent` of that block's text — nothing after.
 * Future post types (video, live feed…) register their own strategy here; the
 * gate code calls `samplePostContent` and never needs to know the type.
 */
import type { Post, } from '@sitesurge/types';
import { truncateHtmlByRatio, } from '@sitesurge/types';

interface SampleBlock {
    type: string;
    data?: Record<string, unknown> | null;
    [k: string]: unknown;
}

export interface PostSample {
    blocks: SampleBlock[];
    /** The legacy `content` field (posts without blocks). */
    content: string;
}

export type PostSampler = (post: Post & { contentBlocks?: unknown[]; }, percent: number,) => PostSample;

const RICH_TEXT = new Set(['rich_text', 'text',],);

/** Article: everything up to the first rich-text block, then N% of its text. */
const articleSampler: PostSampler = (post, percent,) => {
    const ratio = Math.min(1, Math.max(0.01, percent / 100,),);
    const blocks = (post.contentBlocks ?? []) as SampleBlock[];
    const out: SampleBlock[] = [];
    for (const b of blocks) {
        if (RICH_TEXT.has(b.type,)) {
            const html = String(b.data?.content ?? '',);
            out.push({ ...b, data: { ...(b.data ?? {}), content: truncateHtmlByRatio(html, ratio,), }, },);
            break;
        }
        out.push(b,);
    }
    // No rich-text block at all: show nothing past the lead blocks rather
    // than guess which block holds the body.
    const hasText = out.some((b,) => RICH_TEXT.has(b.type,));
    return {
        blocks: hasText ? out : out.slice(0, 1,),
        content: post.content ? truncateHtmlByRatio(post.content, ratio,) : '',
    };
};

export const POST_SAMPLERS: Record<string, PostSampler> = {
    article: articleSampler,
};

export function samplePostContent(post: Post & { contentBlocks?: unknown[]; postType?: string; }, percent: number,): PostSample {
    const sampler = POST_SAMPLERS[post.postType ?? 'article'] ?? articleSampler;
    return sampler(post, percent,);
}
