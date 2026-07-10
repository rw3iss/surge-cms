/**
 * Reference / utility tools — the lookups needed to WIRE content blocks. A
 * form/campaign/social/url_link block references an existing entity by id;
 * these read tools surface those ids (and enough context to pick the right
 * one). See describe_block_types for which block field consumes each id:
 *   - form block      → a form id from list_forms
 *   - campaign block  → a campaign id from list_campaigns
 *   - social block    → provider + optional post ids from list_social_posts
 *   - url_link block  → url_preview unfurls a URL for its title/description/image
 * search_site is a general content locator across posts/pages/campaigns.
 */
import { z, } from 'zod';
import { defineTool, type ToolContext, type ToolDef, } from '../tool';

const tools = [
    defineTool({
        name: 'list_forms',
        description:
            'List forms (id, slug, title, status) to wire a `form` block (set its settings.formId — see describe_block_types). Admin view: all statuses. Returns { data, meta }.',
        inputSchema: {
            search: z.string().optional().describe('Search title / slug.',),
            page: z.number().optional().describe('Page number (1-based).',),
            limit: z.number().optional().describe('Page size.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const res = await ctx.cms.forms.list(args as Record<string, unknown>,);
            return {
                data: res.data.map((f,) => ({ id: f.id, slug: f.slug, title: f.title, status: (f as { status?: string; }).status, }),),
                meta: res.meta,
            };
        },
    },),
    defineTool({
        name: 'list_campaigns',
        description:
            'List campaigns (id, slug, title, status) to wire a `campaign` block (set its settings.campaignId — see describe_block_types). Admin view: all statuses (all=true). Returns { data, meta }.',
        inputSchema: {
            search: z.string().optional().describe('Search title / slug.',),
            page: z.number().optional().describe('Page number (1-based).',),
            limit: z.number().optional().describe('Page size.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const res = await ctx.cms.campaigns.list(args as Record<string, unknown>,);
            return {
                data: res.data.map((c,) => ({ id: c.id, slug: c.slug, title: c.title, status: (c as { status?: string; }).status, }),),
                meta: res.meta,
            };
        },
    },),
    defineTool({
        name: 'list_social_posts',
        description:
            'List stored (synced) social posts to reference in a `social` block (see describe_block_types). Filter by `platform`. Returns { data, meta }; each row is { id, platform, externalId, content?, mediaUrl?, publishedAt }. NOTE: the SDK\'s SocialPost has no single canonical permalink field — the source URL, when present, lives in `rawData`; this tool surfaces the stable id + platform + externalId (what the social block wires against) plus content/media for identification.',
        inputSchema: {
            platform: z.string().optional().describe('Platform filter, e.g. "youtube", "instagram", "x", "facebook", "tiktok", "patreon".',),
            page: z.number().optional().describe('Page number (1-based).',),
            limit: z.number().optional().describe('Page size.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const res = await ctx.cms.social.listPosts(args as Record<string, unknown>,);
            return {
                data: res.data.map((p,) => ({
                    id: p.id,
                    platform: p.platform,
                    externalId: p.externalId,
                    content: p.content,
                    mediaUrl: p.mediaUrl,
                    publishedAt: p.publishedAt,
                }),),
                meta: res.meta,
            };
        },
    },),
    defineTool({
        name: 'search_site',
        description:
            'Global full-text search across content (posts / pages / campaigns). Returns a keyed map of grouped hits ({ posts?, pages?, campaigns? }) — use it to locate an entity id/slug to wire or edit. This is the admin search (all statuses).',
        inputSchema: {
            q: z.string().describe('Search query.',),
            page: z.number().optional().describe('Page number (1-based).',),
            limit: z.number().optional().describe('Page size.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            const { q, ...rest } = args;
            return ctx.cms.search.adminSearch(q, rest as Record<string, unknown>,);
        },
    },),
    defineTool({
        name: 'url_preview',
        description:
            'Unfurl a URL: fetch its OpenGraph / basic metadata → { title?, description?, image?, siteName? } (every field optional; SSRF-guarded server-side). Use it to pre-fill a `url_link` block (see describe_block_types) with a title/description/preview image.',
        inputSchema: {
            url: z.string().describe('The URL to unfurl.',),
        },
        handler: async (args, ctx: ToolContext,) => {
            return ctx.cms.utils.urlPreview({ url: args.url, },);
        },
    },),
];

export const referenceTools: ToolDef[] = tools as unknown as ToolDef[];
