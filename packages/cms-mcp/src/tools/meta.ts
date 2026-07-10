/**
 * Meta / introspection tools: the block-type catalog and a connectivity probe.
 * These carry no writes and are always registered.
 */
import { z, } from 'zod';
import { BLOCK_TYPE_CATALOG, authorableBlockTypes, getBlockSpec, } from '../catalog/blockTypes';
import { defineTool, type ToolDef, } from '../tool';

export const metaTools: ToolDef[] = [
    defineTool({
        name: 'describe_block_types',
        description:
            'Return the authoritative schema for content-block types: fields, defaults, where data lives (content vs settings), page-only flags, and wiring notes. Call this before authoring blocks. Omit `type` for the full catalog, or pass one type for its detail.',
        inputSchema: {
            type: z.string().optional().describe('A single block type key to describe. Omit for all.',),
        },
        handler: async (args,) => {
            if (args.type) {
                const spec = getBlockSpec(args.type,);
                if (!spec) {
                    return { error: `Unknown block type "${args.type}".`, known: authorableBlockTypes(), };
                }
                return spec;
            }
            return {
                authorable: authorableBlockTypes(),
                note: 'group/group_item are page-only (nesting). Deprecated types are listed but cannot be created.',
                types: BLOCK_TYPE_CATALOG,
            };
        },
    },),
    defineTool({
        name: 'whoami',
        description:
            'Connectivity + capability probe. Returns the configured base URL, an API-key preview, read-only mode, and which CMS features are enabled (posts, campaigns, forms, shop, …). Use this first to confirm the server can reach the CMS.',
        handler: async (_args, ctx,) => {
            const base = {
                baseUrl: ctx.config.baseUrl,
                apiKey: ctx.config.apiKeyPreview,
                readonly: ctx.readonly,
            };
            try {
                const settings = await ctx.cms.settings.getPublic();
                return {
                    ...base,
                    connected: true,
                    siteName: settings.siteName,
                    features: settings.features,
                };
            } catch (err) {
                return {
                    ...base,
                    connected: false,
                    error: (err as Error).message,
                };
            }
        },
    },),
];
