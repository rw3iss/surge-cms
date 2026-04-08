/**
 * Server-side meta tag generator.
 * Produces HTML <head> fragments for Open Graph, Twitter Card,
 * JSON-LD, and AEO tags based on the content type of the current route.
 */

export interface MetaTags {
    title: string;
    description?: string;
    canonical?: string;
    image?: string;
    imageAlt?: string;
    type?: 'website' | 'article' | 'profile' | 'product';
    publishedAt?: string;
    modifiedAt?: string;
    author?: string;
    section?: string;
    tags?: string[];
    keywords?: string[];
    noindex?: boolean;
    nofollow?: boolean;
    siteName?: string;
    locale?: string;
    aeoSummary?: string;
    aeoEntityType?: string;
    jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

function escapeHtml(str: string,): string {
    return str
        .replace(/&/g, '&amp;',)
        .replace(/</g, '&lt;',)
        .replace(/>/g, '&gt;',)
        .replace(/"/g, '&quot;',)
        .replace(/'/g, '&#39;',);
}

function buildRobots(meta: MetaTags,): string {
    const parts: string[] = [];
    parts.push(meta.noindex ? 'noindex' : 'index',);
    parts.push(meta.nofollow ? 'nofollow' : 'follow',);
    parts.push('max-snippet:-1', 'max-image-preview:large', 'max-video-preview:-1',);
    return parts.join(', ',);
}

/** Build the full <head> fragment to inject into the HTML template. */
export function buildMetaHtml(meta: MetaTags,): string {
    const siteName = meta.siteName || 'Surge Media';
    const locale = meta.locale || 'en_US';
    const title = meta.title.includes(siteName,) ? meta.title : `${meta.title} | ${siteName}`;
    const lines: string[] = [];

    lines.push(`<title>${escapeHtml(title,)}</title>`,);

    if (meta.description) {
        lines.push(`<meta name="description" content="${escapeHtml(meta.description,)}" />`,);
    }
    if (meta.canonical) {
        lines.push(`<link rel="canonical" href="${escapeHtml(meta.canonical,)}" />`,);
    }

    const robots = buildRobots(meta,);
    lines.push(`<meta name="robots" content="${robots}" />`,);
    lines.push(`<meta name="googlebot" content="${robots}" />`,);

    if (meta.keywords && meta.keywords.length > 0) {
        lines.push(`<meta name="keywords" content="${escapeHtml(meta.keywords.join(', ',),)}" />`,);
    }

    // Open Graph
    lines.push(`<meta property="og:title" content="${escapeHtml(title,)}" />`,);
    if (meta.description) {
        lines.push(`<meta property="og:description" content="${escapeHtml(meta.description,)}" />`,);
    }
    lines.push(`<meta property="og:type" content="${meta.type || 'website'}" />`,);
    if (meta.canonical) {
        lines.push(`<meta property="og:url" content="${escapeHtml(meta.canonical,)}" />`,);
    }
    lines.push(`<meta property="og:site_name" content="${escapeHtml(siteName,)}" />`,);
    lines.push(`<meta property="og:locale" content="${locale}" />`,);

    if (meta.image) {
        lines.push(`<meta property="og:image" content="${escapeHtml(meta.image,)}" />`,);
        lines.push(`<meta property="og:image:secure_url" content="${escapeHtml(meta.image,)}" />`,);
        lines.push(
            `<meta property="og:image:alt" content="${escapeHtml(meta.imageAlt || meta.title,)}" />`,
        );
    }

    // Article-specific
    if (meta.type === 'article') {
        if (meta.publishedAt) {
            lines.push(
                `<meta property="article:published_time" content="${escapeHtml(meta.publishedAt,)}" />`,
            );
        }
        if (meta.modifiedAt) {
            lines.push(
                `<meta property="article:modified_time" content="${escapeHtml(meta.modifiedAt,)}" />`,
            );
        }
        if (meta.author) {
            lines.push(`<meta property="article:author" content="${escapeHtml(meta.author,)}" />`,);
        }
        if (meta.section) {
            lines.push(`<meta property="article:section" content="${escapeHtml(meta.section,)}" />`,);
        }
        if (meta.tags && meta.tags.length > 0) {
            for (const tag of meta.tags) {
                lines.push(`<meta property="article:tag" content="${escapeHtml(tag,)}" />`,);
            }
        }
    }

    // Twitter Card
    lines.push(
        `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}" />`,
    );
    lines.push(`<meta name="twitter:title" content="${escapeHtml(title,)}" />`,);
    if (meta.description) {
        lines.push(`<meta name="twitter:description" content="${escapeHtml(meta.description,)}" />`,);
    }
    if (meta.image) {
        lines.push(`<meta name="twitter:image" content="${escapeHtml(meta.image,)}" />`,);
        lines.push(
            `<meta name="twitter:image:alt" content="${escapeHtml(meta.imageAlt || meta.title,)}" />`,
        );
    }

    // AEO (Answer Engine Optimization)
    if (meta.aeoSummary) {
        lines.push(`<meta name="description-aeo" content="${escapeHtml(meta.aeoSummary,)}" />`,);
        lines.push(`<meta name="answer" content="${escapeHtml(meta.aeoSummary,)}" />`,);
    }
    if (meta.aeoEntityType) {
        lines.push(`<meta name="entity-type" content="${escapeHtml(meta.aeoEntityType,)}" />`,);
    }
    if (meta.jsonLd) {
        lines.push(`<meta name="ai-structured-data" content="true" />`,);
    }

    // JSON-LD
    if (meta.jsonLd) {
        const items = Array.isArray(meta.jsonLd,) ? meta.jsonLd : [meta.jsonLd,];
        for (const item of items) {
            lines.push(
                `<script type="application/ld+json">${JSON.stringify(item,).replace(/</g, '\\u003c',)}</script>`,
            );
        }
    }

    return lines.join('\n        ',);
}
