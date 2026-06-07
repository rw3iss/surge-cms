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
},): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'NewsMediaOrganization',
        name: org.name,
        url: org.url,
        ...(org.logo ? { logo: org.logo, } : {}),
        ...(org.description ? { description: org.description, } : {}),
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
