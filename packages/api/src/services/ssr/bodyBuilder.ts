/**
 * Server-rendered HTML body fragments for the progressive-enhancement
 * SSR layer.
 *
 * The goal is **not** to replicate the SPA's visual output — it's to
 * give crawlers and JS-disabled visitors semantically-rich HTML so
 * they can index every word of every post / page. The Solid SPA's
 * `render()` call overwrites `#root` on mount, so users see the SSR
 * body for at most one frame before the SPA takes over.
 *
 * Renderers here intentionally emit minimal markup (semantic tags,
 * a few utility classes) rather than the SPA's full layout — less
 * surface to drift from the SPA, and the bot doesn't care about
 * styling.
 */

import { sanitize, } from '../../utils/sanitize';
import { renderBlockForSeo, } from './blocks';
import { escapeHtml, isoToReadable, } from './blocks/_util';

// ─── Post detail ────────────────────────────────────────────────

export interface PostBody {
    title: string;
    excerpt?: string | null;
    content?: string | null;
    author?: string | null;
    publishedAt?: string | null;
    tags?: string[] | null;
    featuredImage?: string | null;
}

/**
 * Render a post's HTML body for SSR. Includes title, byline, optional
 * featured image, excerpt, and the post's HTML content (sanitized).
 *
 * Tags become a hidden `<dl>` of categories so search engines can
 * surface category context without cluttering the visual layout the
 * SPA renders a frame later.
 */
export function buildPostBody(p: PostBody,): string {
    const parts: string[] = [];
    parts.push('<article class="ssr-post">',);
    parts.push(`  <h1>${escapeHtml(p.title,)}</h1>`,);

    const metaBits: string[] = [];
    if (p.author) metaBits.push(`<span class="ssr-post__author">${escapeHtml(p.author,)}</span>`,);
    if (p.publishedAt) {
        metaBits.push(
            `<time class="ssr-post__date" datetime="${escapeHtml(p.publishedAt,)}">${escapeHtml(isoToReadable(p.publishedAt,),)}</time>`,
        );
    }
    if (metaBits.length > 0) {
        parts.push(`  <p class="ssr-post__meta">${metaBits.join(' &middot; ',)}</p>`,);
    }

    if (p.featuredImage) {
        parts.push(
            `  <img class="ssr-post__featured" src="${escapeHtml(p.featuredImage,)}" alt="${escapeHtml(p.title,)}" />`,
        );
    }

    if (p.excerpt) {
        parts.push(`  <p class="ssr-post__excerpt">${escapeHtml(p.excerpt,)}</p>`,);
    }

    if (p.content) {
        // The post `content` field is legacy HTML the editor saved
        // with the post. Run it through the existing sanitize
        // pipeline before injecting — same ruleset used for all
        // user-submitted HTML elsewhere in the app.
        parts.push(`  <div class="ssr-post__content">${sanitize(p.content,)}</div>`,);
    }

    if (Array.isArray(p.tags,) && p.tags.length > 0) {
        parts.push(`  <p class="ssr-post__tags">Tags: ${p.tags.map(t => escapeHtml(t,)).join(', ',)}</p>`,);
    }

    parts.push('</article>',);
    return parts.join('\n',);
}

// ─── Page detail ────────────────────────────────────────────────

export interface PageBody {
    title: string;
    showTitle?: boolean;
    description?: string | null;
    blocks?: Array<{
        type: string;
        title?: string | null;
        content?: string | null;
        settings?: Record<string, unknown> | null;
    }>;
}

/**
 * Render a CMS page's HTML body. Honors `showTitle` (matches the
 * public renderer's behavior). Emits the page description and any
 * text-relevant blocks (rich_text, text, html). Skips dynamic blocks
 * (form, social, post_list, carousel, etc.) — bots can't index
 * runtime feeds anyway, and the SPA will render them when it mounts.
 */
export function buildPageBody(p: PageBody,): string {
    const parts: string[] = [];
    parts.push('<article class="ssr-page">',);
    if (p.showTitle !== false && p.title) {
        parts.push(`  <h1>${escapeHtml(p.title,)}</h1>`,);
    }
    if (p.description) {
        parts.push(`  <p class="ssr-page__description">${escapeHtml(p.description,)}</p>`,);
    }
    if (Array.isArray(p.blocks,) && p.blocks.length > 0) {
        for (const block of p.blocks) {
            const html = renderBlockForSeo(block,);
            if (html) parts.push(`  ${html}`,);
        }
    }
    parts.push('</article>',);
    return parts.join('\n',);
}

// ─── Post listing ───────────────────────────────────────────────

export interface PostListItem {
    title: string;
    slug: string;
    excerpt?: string | null;
    publishedAt?: string | null;
}

/** Render the /posts listing page body — heading + linked summaries. */
export function buildPostListBody(siteName: string, items: PostListItem[],): string {
    const parts: string[] = [];
    parts.push('<section class="ssr-post-list">',);
    parts.push(`  <h1>${escapeHtml(`${siteName} Blog`,)}</h1>`,);
    if (items.length === 0) {
        parts.push('  <p>No posts yet.</p>',);
    } else {
        parts.push('  <ul class="ssr-post-list__items">',);
        for (const it of items) {
            parts.push('    <li class="ssr-post-list__item">',);
            parts.push(`      <a href="/posts/${escapeHtml(it.slug,)}"><h2>${escapeHtml(it.title,)}</h2></a>`,);
            if (it.excerpt) {
                parts.push(`      <p>${escapeHtml(it.excerpt,)}</p>`,);
            }
            if (it.publishedAt) {
                parts.push(
                    `      <time datetime="${escapeHtml(it.publishedAt,)}">${escapeHtml(isoToReadable(it.publishedAt,),)}</time>`,
                );
            }
            parts.push('    </li>',);
        }
        parts.push('  </ul>',);
    }
    parts.push('</section>',);
    return parts.join('\n',);
}

// ─── Generic single-section body ────────────────────────────────

/** Catch-all for routes that just need a heading + paragraph (home,
 *  contact, shop, campaign, etc.). */
export function buildGenericBody(title: string, description?: string | null,): string {
    const parts: string[] = ['<section class="ssr-generic">',];
    parts.push(`  <h1>${escapeHtml(title,)}</h1>`,);
    if (description) {
        parts.push(`  <p>${escapeHtml(description,)}</p>`,);
    }
    parts.push('</section>',);
    return parts.join('\n',);
}
