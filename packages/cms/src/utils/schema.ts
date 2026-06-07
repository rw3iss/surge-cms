/**
 * Schema.org JSON-LD builders for structured data.
 * These helpers produce schemas that appear in rich Google results
 * and are consumed by AI answer engines.
 */

export interface OrganizationInput {
    name: string;
    url: string;
    logo?: string;
    sameAs?: string[];
}

export function buildOrganization(org: OrganizationInput,): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'NewsMediaOrganization',
        name: org.name,
        url: org.url,
        ...(org.logo ? { logo: org.logo, } : {}),
        ...(org.sameAs ? { sameAs: org.sameAs, } : {}),
    };
}

export interface ArticleInput {
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
}

export function buildArticle(article: ArticleInput,): Record<string, unknown> {
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
            author: {
                '@type': 'Person',
                name: article.authorName,
            },
        } : {}),
        publisher: {
            '@type': 'NewsMediaOrganization',
            name: article.publisherName,
            ...(article.publisherLogo ? {
                logo: {
                    '@type': 'ImageObject',
                    url: article.publisherLogo,
                },
            } : {}),
        },
        ...(article.articleSection ? { articleSection: article.articleSection, } : {}),
        ...(article.keywords && article.keywords.length > 0 ? { keywords: article.keywords.join(', ',), } : {}),
        mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': article.url,
        },
    };
}

export interface BreadcrumbInput {
    items: Array<{ name: string; url: string; }>;
}

export function buildBreadcrumb(breadcrumb: BreadcrumbInput,): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumb.items.map((item, idx,) => ({
            '@type': 'ListItem',
            position: idx + 1,
            name: item.name,
            item: item.url,
        }),),
    };
}

export interface CollectionPageInput {
    name: string;
    description?: string;
    url: string;
    itemCount?: number;
}

export function buildCollectionPage(collection: CollectionPageInput,): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: collection.name,
        ...(collection.description ? { description: collection.description, } : {}),
        url: collection.url,
        ...(collection.itemCount !== undefined ? {
            mainEntity: {
                '@type': 'ItemList',
                numberOfItems: collection.itemCount,
            },
        } : {}),
    };
}

export interface DonationInput {
    name: string;
    description?: string;
    url: string;
    image?: string;
    goalAmount?: number;
    raisedAmount?: number;
    currency?: string;
    publisherName: string;
}

export function buildDonation(donation: DonationInput,): Record<string, unknown> {
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

export interface WebPageInput {
    name: string;
    description?: string;
    url: string;
    publisherName: string;
    breadcrumb?: Record<string, unknown>;
}

export function buildWebPage(page: WebPageInput,): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: page.name,
        ...(page.description ? { description: page.description, } : {}),
        url: page.url,
        isPartOf: {
            '@type': 'WebSite',
            name: page.publisherName,
        },
        ...(page.breadcrumb ? { breadcrumb: page.breadcrumb, } : {}),
    };
}

export interface FAQInput {
    questions: Array<{ question: string; answer: string; }>;
}

export function buildFAQ(faq: FAQInput,): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.questions.map((q,) => ({
            '@type': 'Question',
            name: q.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: q.answer,
            },
        }),),
    };
}

/** Strip HTML tags from a string — useful for generating clean AEO summaries from rich content. */
export function stripHtml(html: string,): string {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '',).replace(/\s+/g, ' ',).trim();
}

/** Truncate text to a max length with ellipsis, respecting word boundaries. */
export function truncateText(text: string, maxLength: number,): string {
    if (!text || text.length <= maxLength) return text;
    const truncated = text.slice(0, maxLength,);
    const lastSpace = truncated.lastIndexOf(' ',);
    return truncated.slice(0, lastSpace > 0 ? lastSpace : maxLength,) + '...';
}
