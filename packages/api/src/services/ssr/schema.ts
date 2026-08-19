/**
 * Backend Schema.org JSON-LD builders (mirror of frontend utils/schema.ts).
 * Used by SSR to embed structured data in the initial HTML response.
 */

export function buildArticleSchema(article: {
    headline: string;
    description?: string;
    url: string;
    image?: string | string[];
    datePublished?: string | Date;
    dateModified?: string | Date;
    authorName?: string;
    publisherName: string;
    publisherLogo?: string;
    articleSection?: string;
    keywords?: string[];
},): Record<string, unknown> {
    const toIso = (d: string | Date | undefined,) => {
        if (!d) return undefined;
        try {
            return typeof d === 'string' ? new Date(d,).toISOString() : d.toISOString();
        } catch {
            return undefined;
        }
    };

    return {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: article.headline,
        ...(article.description ? { description: article.description, } : {}),
        url: article.url,
        ...(article.image ? { image: article.image, } : {}),
        ...(toIso(article.datePublished,) ? { datePublished: toIso(article.datePublished,), } : {}),
        ...(toIso(article.dateModified,) ? { dateModified: toIso(article.dateModified,), } : {}),
        ...(article.authorName ? {
            author: { '@type': 'Person', name: article.authorName, },
        } : {}),
        publisher: {
            '@type': 'NewsMediaOrganization',
            name: article.publisherName,
            ...(article.publisherLogo ? {
                logo: { '@type': 'ImageObject', url: article.publisherLogo, },
            } : {}),
        },
        ...(article.articleSection ? { articleSection: article.articleSection, } : {}),
        ...(article.keywords && article.keywords.length > 0 ?
            { keywords: article.keywords.join(', ',), } :
            {}),
        mainEntityOfPage: { '@type': 'WebPage', '@id': article.url, },
    };
}

export function buildOrganizationSchema(org: {
    name: string;
    url: string;
    logo?: string;
    description?: string;
    /**
     * Canonical profile URLs for this outlet (social accounts, Wikipedia, etc).
     * `sameAs` is how a search engine ties a site to the OTHER properties that
     * share its name, which is what consolidates them into one brand entity.
     * It matters most when the brand name is contested — several unrelated
     * companies also trade as "Surge Media" — because the social profiles carry
     * the audience signals the new site does not have yet.
     */
    sameAs?: string[];
    /** Free-text service area, e.g. "Philadelphia, Pennsylvania" — a locality
     *  signal for "news near me"-style queries. */
    areaServed?: string;
    email?: string;
},): Record<string, unknown> {
    const sameAs = (org.sameAs ?? []).filter(Boolean,);
    return {
        '@context': 'https://schema.org',
        '@type': 'NewsMediaOrganization',
        name: org.name,
        url: org.url,
        ...(org.logo ? { logo: org.logo, } : {}),
        ...(org.description ? { description: org.description, } : {}),
        ...(sameAs.length ? { sameAs, } : {}),
        ...(org.areaServed ? { areaServed: org.areaServed, } : {}),
        ...(org.email ? { email: org.email, } : {}),
    };
}

/**
 * WebSite node with a SearchAction — makes the site eligible for Google's
 * sitelinks search box, and reinforces the site name Google shows in results
 * (which is otherwise inferred, and was being taken from the template default).
 */
export function buildWebSiteSchema(site: {
    name: string;
    url: string;
    description?: string;
},): Record<string, unknown> {
    const base = site.url.replace(/\/+$/, '',);
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: site.name,
        url: base,
        ...(site.description ? { description: site.description, } : {}),
        potentialAction: {
            '@type': 'SearchAction',
            target: {
                '@type': 'EntryPoint',
                urlTemplate: `${base}/search?q={search_term_string}`,
            },
            'query-input': 'required name=search_term_string',
        },
    };
}

export function buildBreadcrumbSchema(
    items: Array<{ name: string; url: string; }>,
): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, idx,) => ({
            '@type': 'ListItem',
            position: idx + 1,
            name: item.name,
            item: item.url,
        }),),
    };
}

export function buildWebPageSchema(page: {
    name: string;
    description?: string;
    url: string;
    publisherName: string;
},): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: page.name,
        ...(page.description ? { description: page.description, } : {}),
        url: page.url,
        isPartOf: { '@type': 'WebSite', name: page.publisherName, },
    };
}

export function buildCollectionPageSchema(collection: {
    name: string;
    description?: string;
    url: string;
    itemCount?: number;
},): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: collection.name,
        ...(collection.description ? { description: collection.description, } : {}),
        url: collection.url,
        ...(collection.itemCount !== undefined ? {
            mainEntity: { '@type': 'ItemList', numberOfItems: collection.itemCount, },
        } : {}),
    };
}

export function buildDonationSchema(donation: {
    name: string;
    description?: string;
    url: string;
    image?: string;
    goalAmount?: number;
    currency?: string;
    publisherName: string;
},): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'DonateAction',
        name: donation.name,
        ...(donation.description ? { description: donation.description, } : {}),
        url: donation.url,
        ...(donation.image ? { image: donation.image, } : {}),
        recipient: {
            '@type': 'NewsMediaOrganization',
            name: donation.publisherName,
        },
        ...(donation.goalAmount !== undefined ? {
            price: {
                '@type': 'MonetaryAmount',
                currency: donation.currency || 'USD',
                value: (donation.goalAmount / 100).toFixed(2,),
            },
        } : {}),
    };
}

export function stripHtml(html: string,): string {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '',).replace(/\s+/g, ' ',).trim();
}

export function truncateText(text: string, maxLength: number,): string {
    if (!text || text.length <= maxLength) return text;
    const truncated = text.slice(0, maxLength,);
    const lastSpace = truncated.lastIndexOf(' ',);
    return truncated.slice(0, lastSpace > 0 ? lastSpace : maxLength,) + '...';
}
