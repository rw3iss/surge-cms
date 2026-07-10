/**
 * MCP server assembly: register every tool with the SDK, gating write tools when
 * the context is read-only, wrapping returns in a text result, and mapping
 * thrown SDK errors to structured tool errors.
 */
import { McpServer, } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, } from 'zod';
import type { ToolContext, ToolDef, } from './tool';
import { allTools, } from './tools';
import { errorResult, okResult, } from './util/result';

export const SERVER_NAME = 'sitesurge-cms';
export const SERVER_VERSION = '0.1.0';

/** Build a configured McpServer with all (permitted) tools registered. */
export function buildServer(ctx: ToolContext,): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION, },);
    registerTools(server, ctx, allTools(),);
    return server;
}

/** Register a tool list; skips write tools in read-only mode. */
export function registerTools(server: McpServer, ctx: ToolContext, tools: ToolDef[],): number {
    let count = 0;
    for (const tool of tools) {
        if (tool.write && ctx.readonly) continue;
        server.registerTool(
            tool.name,
            {
                description: tool.description,
                inputSchema: (tool.inputSchema ?? {}) as Record<string, z.ZodTypeAny>,
                annotations: { readOnlyHint: !tool.write, },
            },
            async (args: Record<string, unknown>,) => {
                try {
                    const data = await tool.handler(args as never, ctx,);
                    return okResult(data,);
                } catch (err) {
                    return errorResult(err,);
                }
            },
        );
        count++;
    }
    return count;
}
