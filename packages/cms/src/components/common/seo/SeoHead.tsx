import { Link, Meta, Title, } from '@solidjs/meta';
import { Component, createMemo, For, Show, } from 'solid-js';
import {
    DEFAULT_SITE_NAME,
    loadSiteSettings,
    siteSettings as siteSettingsSignal,
} from '../../../stores/siteSettings';
import { JsonLd, } from './JsonLd';

export interface SeoHeadProps {
    // Core
    title: string;
    description?: string;
    canonical?: string;

    // Content type
    type?: 'website' | 'article' | 'profile' | 'product';

    // Images for social sharing
    image?: string;
    imageAlt?: string;

    // Article-specific (type='article')
    publishedAt?: string | Date;
    modifiedAt?: string | Date;
    author?: string;
    section?: string;
    tags?: string[];

    // Indexing
    noindex?: boolean;
    nofollow?: boolean;

    // Keywords
    keywords?: string[];

    // Site metadata (usually from settings)
    siteName?: string;
    locale?: string;
    twitterHandle?: string;

    // Structured data
    jsonLd?: Record<string, unknown> | Record<string, unknown>[];

    // Answer Engine Optimization (AEO) — AI crawler hints
    aeoSummary?: string; // Short factual summary for AI engines
    aeoEntityType?: string; // e.g. "Article", "Organization", "Product"
}

const DEFAULT_LOCALE = 'en_US';

/**
 * Unified SEO/Social/AEO head component.
 * Generates Open Graph, Twitter Card, JSON-LD structured data,
 * and AI engine optimization tags from a single props set.
 *
 * Tab title format is always "{Site Name} - {Page Title}" using the
 * dynamic site name from the global settings store (falls back to
 * the DEFAULT_SITE_NAME constant until settings are loaded). Passing
 * an explicit `siteName` prop overrides the store.
 */
const SeoHead: Component<SeoHeadProps> = (props,) => {
    // Trigger settings load on first render of any page that mounts SeoHead.
    loadSiteSettings();

    const siteName = () =>
        props.siteName || siteSettingsSignal()?.siteName || DEFAULT_SITE_NAME;
    const locale = () => props.locale || DEFAULT_LOCALE;
    const fullTitle = createMemo(() => {
        const pageTitle = props.title?.trim();
        const site = siteName();
        if (!pageTitle) return site;
        // Avoid double-prefix if caller already included the site name.
        if (pageTitle === site) return site;
        if (pageTitle.startsWith(`${site} -`,) || pageTitle.startsWith(`${site} |`,)) {
            return pageTitle;
        }
        return `${site} - ${pageTitle}`;
    },);

    const robotsContent = createMemo(() => {
        const parts: string[] = [];
        if (props.noindex) parts.push('noindex',);
        else parts.push('index',);
        if (props.nofollow) parts.push('nofollow',);
        else parts.push('follow',);
        // Max snippet / image / video previews for richer results
        parts.push('max-snippet:-1', 'max-image-preview:large', 'max-video-preview:-1',);
        return parts.join(', ',);
    },);

    const toIso = (d: string | Date | undefined,) => {
        if (!d) return undefined;
        if (d instanceof Date) return d.toISOString();
        try {
            return new Date(d,).toISOString();
        } catch {
            return undefined;
        }
    };

    const publishedIso = createMemo(() => toIso(props.publishedAt,));
    const modifiedIso = createMemo(() => toIso(props.modifiedAt,) || publishedIso());

    const canonicalUrl = createMemo(() => {
        if (props.canonical) return props.canonical;
        if (typeof window !== 'undefined') return window.location.href.split('?',)[0];
        return '';
    },);

    return (
        <>
            {/* ─── Core ─── */}
            <Title>{fullTitle()}</Title>
            <Show when={props.description}>
                <Meta name="description" content={props.description!} />
            </Show>
            <Show when={canonicalUrl()}>
                <Link rel="canonical" href={canonicalUrl()} />
            </Show>

            {/* ─── Robots / Indexing ─── */}
            <Meta name="robots" content={robotsContent()} />
            <Meta name="googlebot" content={robotsContent()} />

            {/* ─── Keywords ─── */}
            <Show when={props.keywords && props.keywords.length > 0}>
                <Meta name="keywords" content={props.keywords!.join(', ',)} />
            </Show>

            {/* ─── Open Graph (Facebook, LinkedIn, etc.) ─── */}
            <Meta property="og:title" content={fullTitle()} />
            <Show when={props.description}>
                <Meta property="og:description" content={props.description!} />
            </Show>
            <Meta property="og:type" content={props.type || 'website'} />
            <Meta property="og:url" content={canonicalUrl()} />
            <Meta property="og:site_name" content={siteName()} />
            <Meta property="og:locale" content={locale()} />
            <Show when={props.image}>
                <Meta property="og:image" content={props.image!} />
                <Meta property="og:image:secure_url" content={props.image!} />
                <Meta property="og:image:alt" content={props.imageAlt || props.title} />
            </Show>

            {/* ─── Article-specific (Open Graph) ─── */}
            <Show when={props.type === 'article'}>
                <Show when={publishedIso()}>
                    <Meta property="article:published_time" content={publishedIso()!} />
                </Show>
                <Show when={modifiedIso()}>
                    <Meta property="article:modified_time" content={modifiedIso()!} />
                </Show>
                <Show when={props.author}>
                    <Meta property="article:author" content={props.author!} />
                </Show>
                <Show when={props.section}>
                    <Meta property="article:section" content={props.section!} />
                </Show>
                <Show when={props.tags && props.tags.length > 0}>
                    <For each={props.tags}>
                        {(tag,) => <Meta property="article:tag" content={tag} />}
                    </For>
                </Show>
            </Show>

            {/* ─── Twitter Card ─── */}
            <Meta name="twitter:card" content={props.image ? 'summary_large_image' : 'summary'} />
            <Meta name="twitter:title" content={fullTitle()} />
            <Show when={props.description}>
                <Meta name="twitter:description" content={props.description!} />
            </Show>
            <Show when={props.image}>
                <Meta name="twitter:image" content={props.image!} />
                <Meta name="twitter:image:alt" content={props.imageAlt || props.title} />
            </Show>
            <Show when={props.twitterHandle}>
                <Meta name="twitter:site" content={props.twitterHandle!} />
                <Meta name="twitter:creator" content={props.twitterHandle!} />
            </Show>

            {/* ─── Answer Engine Optimization (AEO) ─── */}
            {/* Hints for AI crawlers (ChatGPT, Perplexity, Claude, Gemini, etc.) */}
            <Show when={props.aeoSummary}>
                <Meta name="description-aeo" content={props.aeoSummary!} />
                <Meta name="answer" content={props.aeoSummary!} />
            </Show>
            <Show when={props.aeoEntityType}>
                <Meta name="entity-type" content={props.aeoEntityType!} />
            </Show>
            {/* Signal to AI crawlers that structured data is present */}
            <Show when={props.jsonLd}>
                <Meta name="ai-structured-data" content="true" />
            </Show>

            {/* ─── JSON-LD Structured Data ─── */}
            <Show when={props.jsonLd}>
                {Array.isArray(props.jsonLd) ?
                    <For each={props.jsonLd as Record<string, unknown>[]}>
                        {(item,) => <JsonLd data={item} />}
                    </For> :
                    <JsonLd data={props.jsonLd as Record<string, unknown>} />}
            </Show>
        </>
    );
};

export default SeoHead;
