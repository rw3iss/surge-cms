/**
 * Tool framework. Every MCP tool is a `ToolDef`: a name, a rich description
 * (with wiring hints for the agent), an optional Zod input shape, a `write`
 * flag (gated by CMS_MCP_READONLY), and a handler that returns any JSON-able
 * value. `server.ts` registers each def with the MCP SDK, wraps the return in
 * a text result, and maps thrown SDK errors to structured tool errors.
 */
import type { z, ZodRawShape, } from 'zod';
import type { CmsClient, } from '@rw/cms-client';

/** Runtime passed to every tool handler. */
export interface ToolContext {
    cms: CmsClient;
    /** When true, write tools are not registered. */
    readonly: boolean;
    config: {
        baseUrl: string;
        /** Trimmed key preview (never the full key) for whoami. */
        apiKeyPreview: string;
    };
}

export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
    name: string;
    description: string;
    /** Zod raw shape (object of zod schemas). Omit for zero-arg tools. */
    inputSchema?: Shape;
    /** Marks a mutating tool; skipped when the server is read-only. */
    write?: boolean;
    handler: (args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext,) => Promise<unknown>;
}

/** Identity helper that preserves the input-shape generic for handler typing. */
export function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>,): ToolDef<Shape> {
    return def;
}
