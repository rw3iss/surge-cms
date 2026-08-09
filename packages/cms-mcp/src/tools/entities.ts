/**
 * Generic entity tools — manage entity TYPES (schema) + entity INSTANCES for
 * any type (custom or core) through the CMS client. Mirrors the SDK surface
 * (`cms.entityTypes`, `cms.entities`).
 */
import { z, } from 'zod';
import { defineTool, type ToolDef, } from '../tool';

const fieldShape = z.object({
    key: z.string(),
    label: z.string().optional(),
    type: z.string().describe('text|longtext|richtext|markdown|number|integer|boolean|date|datetime|enum|json|media|relation|slug|blocks'),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    indexed: z.boolean().optional(),
    searchable: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    options: z.record(z.string(), z.unknown(),).optional(),
    position: z.number().optional(),
},);

const tools = [
    defineTool({
        name: 'list_entity_types',
        description: 'List all entity type definitions (core + custom) with their field schemas.',
        handler: async (_args, ctx,) => ctx.cms.entityTypes.list(),
    },),
    defineTool({
        name: 'describe_entity_types',
        description: 'Describe every entity type: key, singular/plural template vars, and each field '
            + '(key, type, flags). Use before authoring `{{ }}` or content-block templates for an entity.',
        handler: async (_args, ctx,) => {
            const types = await ctx.cms.entityTypes.list();
            return types.map((t,) => ({
                key: t.key,
                label: t.label,
                origin: t.origin,
                templateVars: { single: t.singularVar, list: t.pluralVar, },
                fields: t.fields.map((f,) => ({ key: f.key, type: f.type, core: f.core, required: f.required, })),
            }),);
        },
    },),
    defineTool({
        name: 'get_entity_type',
        description: 'Get one entity type definition by key.',
        inputSchema: { key: z.string(), },
        handler: async (args, ctx,) => ctx.cms.entityTypes.getOne(args.key,),
    },),
    defineTool({
        name: 'create_entity_type',
        description: 'Create a CUSTOM entity type. A backing table is generated automatically. '
            + '`key` is the machine name (snake_case; becomes the {{key(...)}} function).',
        write: true,
        inputSchema: {
            key: z.string(),
            label: z.string(),
            labelPlural: z.string().optional(),
            description: z.string().optional(),
            hasSlug: z.boolean().optional(),
            hasStatus: z.boolean().optional(),
            searchable: z.boolean().optional(),
            fields: z.array(fieldShape,).optional(),
        },
        handler: async (args, ctx,) => ctx.cms.entityTypes.create(args as never,),
    },),
    defineTool({
        name: 'update_entity_type',
        description: 'Update an entity type (props + non-core fields). Core fields are locked. '
            + 'Adding a field ALTERs the table; removing a non-core field drops its column.',
        write: true,
        inputSchema: {
            key: z.string(),
            label: z.string().optional(),
            labelPlural: z.string().optional(),
            description: z.string().optional(),
            hasStatus: z.boolean().optional(),
            searchable: z.boolean().optional(),
            fields: z.array(fieldShape,).optional(),
        },
        handler: async (args, ctx,) => {
            const { key, ...patch } = args;
            return ctx.cms.entityTypes.update(key, patch as never,);
        },
    },),
    defineTool({
        name: 'delete_entity_type',
        description: 'Delete a CUSTOM entity type and drop its table. Core types are protected.',
        write: true,
        inputSchema: { key: z.string(), },
        handler: async (args, ctx,) => ctx.cms.entityTypes.remove(args.key,),
    },),

    // ── Instances ──
    defineTool({
        name: 'list_entities',
        description: 'List/query records of an entity type (pagination, sort, search, JSON filter).',
        inputSchema: {
            type: z.string(),
            page: z.number().optional(),
            limit: z.number().optional(),
            sortBy: z.string().optional(),
            sortOrder: z.enum(['asc', 'desc',],).optional(),
            search: z.string().optional(),
            status: z.string().optional(),
            filter: z.record(z.string(), z.unknown(),).optional(),
        },
        handler: async (args, ctx,) => {
            const { type, ...q } = args;
            return ctx.cms.entities.list(type, q as never,);
        },
    },),
    defineTool({
        name: 'get_entity',
        description: 'Get one entity record by id or slug.',
        inputSchema: { type: z.string(), idOrSlug: z.string(), },
        handler: async (args, ctx,) => ctx.cms.entities.getOne(args.type, args.idOrSlug,),
    },),
    defineTool({
        name: 'create_entity',
        description: 'Create an entity record. `data` holds the schema field values.',
        write: true,
        inputSchema: { type: z.string(), data: z.record(z.string(), z.unknown(),), },
        handler: async (args, ctx,) => ctx.cms.entities.create(args.type, args.data,),
    },),
    defineTool({
        name: 'update_entity',
        description: 'Update an entity record by id.',
        write: true,
        inputSchema: { type: z.string(), id: z.string(), data: z.record(z.string(), z.unknown(),), },
        handler: async (args, ctx,) => ctx.cms.entities.update(args.type, args.id, args.data,),
    },),
    defineTool({
        name: 'delete_entity',
        description: 'Delete an entity record by id.',
        write: true,
        inputSchema: { type: z.string(), id: z.string(), },
        handler: async (args, ctx,) => ctx.cms.entities.remove(args.type, args.id,),
    },),
];

export const entityTools: ToolDef[] = tools as unknown as ToolDef[];
