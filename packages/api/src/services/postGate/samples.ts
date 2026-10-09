/**
 * Content samples for locked posts, by post TYPE.
 *
 * Each strategy decides what a non-subscriber sees of a post. The strategy is
 * picked by the post TYPE's `sampler` key (`getPostType(post.postType).sampler`,
 * see @sitesurge/types utils/postTypes); the gate code calls
 * `samplePostContent` and never needs to know the type.
 *   - article: the blocks BEFORE the first rich-text block (banner image,
 *     intro video…) plus the first `percent` of that block's text.
 *   - video: the lead blocks up to AND including the first video block (the
 *     player itself only plays a teaser to non-subscribers), then the article
 *     rule for a rich-text block that directly follows it.
 *   - live: no body — just the first lead block, if any.
 */
import type { Post, } from '@sitesurge/types';
import { getPostType, truncateHtmlByRatio, } from '@sitesurge/types';

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

const VIDEO = new Set(['video',],);

/** Video: lead blocks through the first video block, then N% of a following rich text. */
const videoSampler: PostSampler = (post, percent,) => {
    const blocks = (post.contentBlocks ?? []) as SampleBlock[];
    const vi = blocks.findIndex((b,) => VIDEO.has(b.type,));
    // No video block: treat it as an article.
    if (vi === -1) return articleSampler(post, percent,);
    const ratio = Math.min(1, Math.max(0.01, percent / 100,),);
    const out = blocks.slice(0, vi + 1,);
    const next = blocks[vi + 1];
    if (next && RICH_TEXT.has(next.type,)) {
        const html = String(next.data?.content ?? '',);
        out.push({ ...next, data: { ...(next.data ?? {}), content: truncateHtmlByRatio(html, ratio,), }, },);
    }
    return { blocks: out, content: post.content ? truncateHtmlByRatio(post.content, ratio,) : '', };
};

/** Live: no body, only the first lead block (e.g. a poster image). */
const liveSampler: PostSampler = (post,) => {
    const blocks = (post.contentBlocks ?? []) as SampleBlock[];
    const first = blocks[0];
    return { blocks: first && !RICH_TEXT.has(first.type,) ? [first,] : [], content: '', };
};

export const POST_SAMPLERS: Record<string, PostSampler> = {
    article: articleSampler,
    video: videoSampler,
    live: liveSampler,
};

export function samplePostContent(post: Post & { contentBlocks?: unknown[]; }, percent: number,): PostSample {
    const key = getPostType(post.postType,).sampler ?? 'article';
    const sampler = POST_SAMPLERS[key] ?? articleSampler;
    return sampler(post, percent,);
}
