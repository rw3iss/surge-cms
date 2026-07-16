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
    /** Operator-configured favicon URL. Emitted as `<link rel="icon">` so the
     *  site's favicon renders instead of the static default. */
    favicon?: string;
    aeoSummary?: string;
    aeoEntityType?: string;
    jsonLd?: Record<string, unknown> | Record<string, unknown>[];
    /** Optional pre-rendered HTML to inject into the page body
     *  (replaces the SPA's loading shell on first paint). Used by the
     *  progressive-enhancement SSR layer so bots see real content
     *  even without executing JS. The Solid SPA's `render()` will
     *  overwrite `#root` once it mounts, so this string only needs to
     *  be SEMANTICALLY correct — visual fidelity is not required. */
    body?: string;
}

function escapeHtml(str: unknown,): string {
    if (str === null || str === undefined) return '';
    // Coerce to ISO string for Date objects; toString() for everything else.
    let s: string;
    if (str instanceof Date) {
        s = str.toISOString();
    } else if (typeof str === 'string') {
        s = str;
    } else {
        s = String(str,);
    }
    return s
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
    const siteName = meta.siteName || 'RW';
    const locale = meta.locale || 'en_US';
    // Title format: "{Site Name} - {Page Title}"
    const pageTitle = (meta.title || '').trim();
    let title: string;
    if (!pageTitle) {
        title = siteName;
    } else if (
        pageTitle === siteName ||
        pageTitle.startsWith(`${siteName} -`,) ||
        pageTitle.startsWith(`${siteName} |`,)
    ) {
        title = pageTitle;
    } else {
        title = `${siteName} - ${pageTitle}`;
    }
    const lines: string[] = [];

    lines.push(`<title>${escapeHtml(title,)}</title>`,);

    // Favicon — emitted after the static template's default so the operator's
    // configured icon wins (later same-rel <link> takes precedence).
    if (meta.favicon) {
        lines.push(`<link rel="icon" href="${escapeHtml(meta.favicon,)}" />`,);
    }

    if (meta.description) {
        lines.push(`<meta name="description" content="${escapeHtml(meta.description,)}" />`,);
    }
    if (meta.canonical) {
        lines.push(`<link rel="canonical" href="${escapeHtml(meta.canonical,)}" />`,);
    }

    // RSS feed discovery — feed readers and bots scan for an
    // `<link rel="alternate" type="application/rss+xml">` tag in the
    // <head> to find the site's syndication URL. Hardcoded path
    // matches the route mounted at /feed.xml.
    lines.push(
        `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(siteName,)} — Posts" href="/feed.xml" />`,
    );

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
